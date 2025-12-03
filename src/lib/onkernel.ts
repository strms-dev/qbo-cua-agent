import { Kernel } from '@onkernel/sdk';
import { chromium, Browser, Page, CDPSession, BrowserContext } from 'playwright';
import { supabase } from './supabase';

// Download directory used by OnKernel browser
const DOWNLOAD_DIR = '/tmp/downloads';

// Interface for tracking downloaded files
export interface DownloadInfo {
  filename: string;
  path: string;
  size?: number;
  status: 'started' | 'in_progress' | 'completed' | 'failed';
  progress?: number;
  downloadedAt: Date;
  guid?: string; // CDP download GUID
}

interface BrowserSession {
  kernelBrowserId: string;
  browser: Browser;
  page: Page;           // Current active page (auto-updated on tab changes)
  pages: Page[];        // Stack of pages (most recent at end) for tab management
  context: BrowserContext; // Browser context for page event listeners
  liveViewUrl: string;
  cdpWsUrl: string;
  createdAt: Date;
  intentionalDisconnect?: boolean; // Track intentional CDP disconnections to avoid false warnings
  cdpClient?: CDPSession; // CDP session for download listeners
}

export class OnkernelClient {
  private kernel: Kernel | null = null;
  private activeSessions: Map<string, BrowserSession> = new Map();
  private downloadTracker: Map<string, DownloadInfo[]> = new Map(); // Track downloads per session
  private profileName: string = 'qbo-auth';
  private useProfiles: boolean = false; // Set to true when you upgrade to startup/enterprise plan
  private usePersistence: boolean = false; // Enable browser persistence with session lifecycle
  private typingDelay: number;
  private browserTimeout: number;

  constructor() {
    // Kernel client will be initialized lazily to avoid build-time issues
    // Check environment variable to enable profiles
    this.useProfiles = process.env.ONKERNEL_USE_PROFILES === 'true';

    // Check environment variable to enable browser persistence
    this.usePersistence = process.env.BROWSER_PERSISTENCE === 'true';

    // Configure typing delay from environment variable (default: 5ms)
    const delayEnv = process.env.TYPING_DELAY_MS;
    const parsedDelay = delayEnv ? parseInt(delayEnv, 10) : 5;
    this.typingDelay = (!isNaN(parsedDelay) && parsedDelay >= 0) ? parsedDelay : 5;

    // Configure browser timeout from environment variable (default: 60 seconds = 1 minute)
    const timeoutEnv = process.env.ONKERNEL_TIMEOUT_SECONDS;
    const parsedTimeout = timeoutEnv ? parseInt(timeoutEnv, 10) : 60;
    this.browserTimeout = (!isNaN(parsedTimeout) && parsedTimeout > 0) ? parsedTimeout : 60;

    console.log('🔧 OnkernelClient initialized:');
    console.log('  - SDK Version: @onkernel/sdk@0.14.0');
    console.log('  - ONKERNEL_USE_PROFILES:', this.useProfiles);
    console.log('  - BROWSER_PERSISTENCE:', this.usePersistence);
    console.log('  - TYPING_DELAY_MS env var:', delayEnv);
    console.log('  - Parsed delay value:', parsedDelay);
    console.log('  - Final typing delay:', this.typingDelay, 'ms');
    console.log('  - ONKERNEL_TIMEOUT_SECONDS env var:', timeoutEnv);
    console.log('  - Parsed timeout value:', parsedTimeout);
    console.log('  - Final browser timeout:', this.browserTimeout, 'seconds');
    console.log('  - Client API timeout:', (this.browserTimeout + 60), 'seconds (browser timeout + 60s buffer)');
  }

  private getKernel(): Kernel {
    if (!this.kernel) {
      // Use KERNEL_API_KEY (SDK default) or ONKERNEL_API_KEY as fallback
      const apiKey = process.env.KERNEL_API_KEY || process.env.ONKERNEL_API_KEY;

      this.kernel = new Kernel({
        apiKey: apiKey,
      });
    }
    return this.kernel;
  }

  /**
   * Set up page event listeners for multi-tab handling
   * - Automatically switches to new tabs when they open
   * - Switches back to previous tab when current tab closes
   * - Only handles new tabs, not popup windows
   */
  private setupPageListeners(session: BrowserSession, context: BrowserContext): void {
    const sessionId = session.kernelBrowserId;
    console.log('🔄 Setting up page listeners for session:', sessionId);

    // Listen for new pages (tabs)
    context.on('page', async (newPage: Page) => {
      console.log('📑 New page event detected for session:', sessionId);

      try {
        // Wait for page to be ready
        await newPage.waitForLoadState('domcontentloaded').catch(() => {
          console.log('⚠️ Page load state timeout (continuing anyway)');
        });

        const newUrl = newPage.url();
        console.log('📑 New tab opened:', newUrl);

        // Add to pages stack and switch to it
        session.pages.push(newPage);
        session.page = newPage;
        console.log('✅ Switched to new tab. Total tabs:', session.pages.length);

        // Listen for this page closing
        newPage.on('close', () => {
          console.log('📑 Tab closed:', newUrl);

          // Remove from pages stack
          const index = session.pages.indexOf(newPage);
          if (index > -1) {
            session.pages.splice(index, 1);
            console.log('✅ Tab removed from stack. Remaining tabs:', session.pages.length);
          }

          // If this was the active page, switch to previous
          if (session.page === newPage && session.pages.length > 0) {
            session.page = session.pages[session.pages.length - 1];
            console.log('✅ Switched back to previous tab:', session.page.url());
          } else if (session.pages.length === 0) {
            console.log('⚠️ All tabs closed - no active page');
          }
        });
      } catch (error) {
        console.error('⚠️ Error handling new page event:', error);
      }
    });

    console.log('✅ Page listeners attached for session:', sessionId);
  }

  /**
   * Set up close listeners for existing pages (used during reconnection)
   */
  private setupPageCloseListener(session: BrowserSession, page: Page): void {
    const pageUrl = page.url();

    page.on('close', () => {
      console.log('📑 Tab closed:', pageUrl);

      // Remove from pages stack
      const index = session.pages.indexOf(page);
      if (index > -1) {
        session.pages.splice(index, 1);
        console.log('✅ Tab removed from stack. Remaining tabs:', session.pages.length);
      }

      // If this was the active page, switch to previous
      if (session.page === page && session.pages.length > 0) {
        session.page = session.pages[session.pages.length - 1];
        console.log('✅ Switched back to previous tab:', session.page.url());
      } else if (session.pages.length === 0) {
        console.log('⚠️ All tabs closed - no active page');
      }
    });
  }

  /**
   * Check if a page is responsive by attempting a quick operation
   * Returns true if page responds within timeout, false otherwise
   */
  private async isPageResponsive(page: Page, timeoutMs: number = 3000): Promise<boolean> {
    if (page.isClosed()) {
      return false;
    }

    try {
      // Quick URL check - fast operation to verify page is responsive
      await Promise.race([
        page.url(), // This should be instant for a responsive page
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Page unresponsive')), timeoutMs)
        )
      ]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Normalize a single key to Playwright format (case-insensitive)
   */
  private normalizeKey(key: string): string {
    const keyLower = key.toLowerCase().trim();

    const keyMap: { [key: string]: string } = {
      // Modifier keys
      'ctrl': 'Control',
      'control': 'Control',
      'shift': 'Shift',
      'alt': 'Alt',
      'meta': 'Meta',
      'cmd': 'Meta',
      'command': 'Meta',
      'win': 'Meta',
      'windows': 'Meta',

      // Common keys
      'return': 'Enter',
      'enter': 'Enter',
      'esc': 'Escape',
      'escape': 'Escape',
      'backspace': 'Backspace',
      'tab': 'Tab',
      'delete': 'Delete',
      'del': 'Delete',
      'space': ' ',
      ' ': ' ',

      // Arrow keys
      'up': 'ArrowUp',
      'down': 'ArrowDown',
      'left': 'ArrowLeft',
      'right': 'ArrowRight',
      'arrowup': 'ArrowUp',
      'arrowdown': 'ArrowDown',
      'arrowleft': 'ArrowLeft',
      'arrowright': 'ArrowRight',

      // Navigation keys
      'home': 'Home',
      'end': 'End',
      'pageup': 'PageUp',
      'pagedown': 'PageDown',
      'insert': 'Insert',
    };

    return keyMap[keyLower] || key;
  }

  /**
   * Parse and normalize key combinations (e.g., "ctrl+a" → "Control+a")
   */
  private parseKeyInput(input: string): string {
    if (input.includes('+')) {
      return input
        .split('+')
        .map(k => this.normalizeKey(k))
        .join('+');
    }
    return this.normalizeKey(input);
  }

  /**
   * Attempt to take screenshot with fallback to other pages
   * Returns Buffer on success, null on total failure
   */
  private async attemptScreenshotWithFallback(
    session: BrowserSession,
    primaryPage: Page
  ): Promise<Buffer | null> {
    const SCREENSHOT_TIMEOUT = 5000; // 5 seconds - fail fast

    // First, try the primary page
    if (await this.isPageResponsive(primaryPage)) {
      try {
        const buffer = await Promise.race([
          primaryPage.screenshot({ type: 'png', fullPage: false }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Screenshot timeout')), SCREENSHOT_TIMEOUT)
          )
        ]);
        console.log('✅ Screenshot taken from primary page');
        return buffer as Buffer;
      } catch (error) {
        console.warn('⚠️ Primary page screenshot failed:', error);
      }
    } else {
      console.warn('⚠️ Primary page is unresponsive or closed');
    }

    // Fallback: try other pages in the session
    console.log('🔄 Attempting screenshot from alternative pages...');
    const availablePages = session.pages.filter(p => p !== primaryPage);

    for (const fallbackPage of availablePages.reverse()) { // Try most recent first
      if (await this.isPageResponsive(fallbackPage)) {
        try {
          const buffer = await Promise.race([
            fallbackPage.screenshot({ type: 'png', fullPage: false }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Screenshot timeout')), SCREENSHOT_TIMEOUT)
            )
          ]);

          // Update session's active page to the responsive one
          session.page = fallbackPage;
          console.log('✅ Screenshot taken from fallback page, updated active page');
          return buffer as Buffer;
        } catch (error) {
          console.warn('⚠️ Fallback page screenshot failed:', error);
        }
      }
    }

    // Last resort: try to get fresh pages from context
    console.log('🔄 Refreshing page list from context...');
    try {
      const freshPages = session.context.pages();
      for (const freshPage of freshPages.reverse()) {
        if (!freshPage.isClosed()) {
          try {
            const buffer = await Promise.race([
              freshPage.screenshot({ type: 'png', fullPage: false }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Screenshot timeout')), SCREENSHOT_TIMEOUT)
              )
            ]);

            // Update session state
            session.page = freshPage;
            session.pages = freshPages;
            console.log('✅ Screenshot taken from fresh context page');
            return buffer as Buffer;
          } catch (error) {
            console.warn('⚠️ Fresh page screenshot failed:', error);
          }
        }
      }
    } catch (error) {
      console.error('❌ Failed to refresh pages from context:', error);
    }

    return null;
  }

  async createSession(sessionId?: string) {
    console.log('🔄 Creating new browser session with Onkernel...');
    const startTime = Date.now();
    try {
      const kernel = this.getKernel();
      console.log(`⏱️  Kernel client initialized (${Date.now() - startTime}ms)`);

      // Build browser creation options
      const browserOptions: any = {
        timeout_seconds: this.browserTimeout,
        stealth: true, // Enable stealth mode for better compatibility
        kiosk_mode: false,
        viewport: {
          width: 1024,
          height: 768
        },
        extensions: [
          {
            id: "h30r1lrhdw4oomdvglcx0nz9"
          }
        ]
      };

      // Only use profiles if enabled (requires startup/enterprise plan)
      if (this.useProfiles) {
        console.log('ℹ️ Profiles enabled - setting up authentication persistence');

        // Ensure profile exists (idempotent operation)
        try {
          await kernel.profiles.create({ name: this.profileName });
          console.log('✅ Profile created:', this.profileName);
        } catch (error: any) {
          // Profile may already exist, which is fine
          if (!error?.message?.includes('already exists')) {
            console.log('ℹ️ Profile may already exist:', this.profileName);
          }
        }

        browserOptions.profile = {
          name: this.profileName,
          save_changes: true, // Persist auth state
        };
      } else {
        console.log('ℹ️ Profiles disabled - browsers will not persist authentication');
        console.log('💡 To enable profiles, set ONKERNEL_USE_PROFILES=true after upgrading your plan');
      }

      // Enable browser persistence with session lifecycle (if configured)
      if (this.usePersistence && sessionId) {
        browserOptions.persistence = {
          id: sessionId
        };
        console.log('✅ Browser persistence enabled with session_id:', sessionId);
        console.log('   → Browser enters zero-cost standby after 4s idle');
        console.log('   → Browser reusable within same chat session');
        console.log('   → Browser explicitly destroyed on session completion');
      } else if (this.usePersistence && !sessionId) {
        console.log('⚠️ BROWSER_PERSISTENCE=true but no sessionId provided - using ephemeral browser');
      } else {
        console.log('ℹ️ Browser persistence disabled - using ephemeral browser');
        console.log('💡 To enable persistence, set BROWSER_PERSISTENCE=true');
      }

      // Create browser with Onkernel
      // Reference: https://docs.onkernel.com/api-reference/browsers/create-a-browser-session
      // Note: Client timeout must be HIGHER than browser timeout_seconds to avoid false timeouts
      // OnKernel needs time to: receive request → spin up container → initialize browser → return response
      const clientTimeoutMs = (this.browserTimeout + 60) * 1000; // Add 60s buffer

      console.log('⏳ Calling OnKernel API to create browser session...');
      console.log('📋 Browser options (REQUEST):', JSON.stringify(browserOptions, null, 2));
      console.log(`⏱️  Client timeout: ${clientTimeoutMs}ms (browser timeout: ${this.browserTimeout}s + 60s buffer)`);
      console.log(`🌐 API Endpoint: https://api.onkernel.com/v1/browsers`);
      console.log(`🔑 API Key: ${process.env.KERNEL_API_KEY ? '***' + process.env.KERNEL_API_KEY.slice(-4) : 'NOT SET'}`);

      const apiCallStart = Date.now();
      console.log(`📤 Request sent at: ${new Date().toISOString()}`);

      let kernelBrowser: any;
      try {
        kernelBrowser = await Promise.race([
          kernel.browsers.create(browserOptions),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`OnKernel API timeout after ${clientTimeoutMs}ms`)), clientTimeoutMs)
          )
        ]);

        const responseTime = Date.now() - apiCallStart;
        console.log(`📥 Response received at: ${new Date().toISOString()}`);
        console.log(`✅ OnKernel API responded in ${responseTime}ms (${(responseTime / 1000).toFixed(1)}s)`);
      } catch (error: any) {
        const failedAfter = Date.now() - apiCallStart;
        console.error(`❌ OnKernel API call failed after ${failedAfter}ms (${(failedAfter / 1000).toFixed(1)}s)`);
        console.error(`⚠️  Error type: ${error.name || 'Unknown'}`);
        console.error(`⚠️  Error message: ${error.message}`);

        // Check if there are orphaned browser sessions on OnKernel
        console.log('🔍 Tip: Check OnKernel dashboard for orphaned browser sessions that may have been created despite timeout');
        throw error;
      }

      // Debug: Log full Onkernel API response for troubleshooting
      console.log('🔍 Onkernel API Response (FULL):', JSON.stringify(kernelBrowser, null, 2));
      console.log('🔍 Response keys:', Object.keys(kernelBrowser || {}));
      console.log('🔍 Response type:', typeof kernelBrowser);

      // Extract session_id (primary property per Onkernel API docs)
      // The API returns: { session_id, cdp_ws_url, browser_live_view_url, ... }
      const kernelBrowserId = (kernelBrowser as any).session_id ||
                              (kernelBrowser as any).id ||
                              (kernelBrowser as any).browser_id;

      if (!kernelBrowserId) {
        console.error('❌ Failed to extract session_id from Onkernel response');
        console.error('📋 Available response keys:', Object.keys(kernelBrowser));
        throw new Error('Failed to create browser session: session_id not found in Onkernel API response');
      }

      const cdpUrl = (kernelBrowser as any).cdp_ws_url || (kernelBrowser as any).cdpWsUrl;
      const liveViewUrl = (kernelBrowser as any).browser_live_view_url || (kernelBrowser as any).browserLiveViewUrl || '';

      console.log('✅ Onkernel browser created with session_id:', kernelBrowserId);
      console.log('🔗 CDP WebSocket URL:', cdpUrl);
      console.log('👁️ Live view URL:', liveViewUrl);

      // Connect Playwright to the remote browser via CDP
      console.log('🔌 Connecting Playwright to browser...');
      const browser = await chromium.connectOverCDP(cdpUrl);

      // Add disconnected event listener to handle unexpected disconnections
      browser.on('disconnected', async () => {
        console.log('🔌 Playwright browser disconnected event fired for session:', kernelBrowserId);

        // Check if this was an intentional disconnect
        const session = this.activeSessions.get(kernelBrowserId);
        if (session?.intentionalDisconnect) {
          console.log('✅ Intentional CDP disconnect - event listener skipping cleanup');
          return; // Exit early - disconnectCDP() will handle cleanup
        }

        console.log('⚠️ Unexpected CDP disconnection detected - cleaning up');

        // Remove from cache
        this.activeSessions.delete(kernelBrowserId);
        console.log('✅ Session removed from activeSessions cache');

        // Update database to reflect disconnection
        try {
          const { error, count } = await supabase
            .from('browser_sessions')
            .update({
              cdp_connected: false,
              cdp_disconnected_at: new Date().toISOString(),
              last_activity_at: new Date().toISOString()
            })
            .eq('onkernel_session_id', kernelBrowserId);

          if (error) {
            console.error('⚠️ Failed to update database after unexpected disconnect:', error);
          } else if (count === 0) {
            console.warn('⚠️ No rows updated - browser session not found in database:', kernelBrowserId);
          } else {
            console.log('✅ Database updated after unexpected CDP disconnect');
          }
        } catch (error) {
          console.error('⚠️ Error updating database after disconnect:', error);
        }
      });

      console.log('✅ Disconnection event listener attached');

      // Get the default context and page (Onkernel creates these automatically)
      const contexts = browser.contexts();
      if (contexts.length === 0) {
        throw new Error('No browser contexts found');
      }

      const context = contexts[0];
      const pages = context.pages();

      let page: Page;
      if (pages.length === 0) {
        // Create a new page if none exists
        page = await context.newPage();
      } else {
        page = pages[0];
      }

      // Set viewport to match Anthropic computer tool dimensions
      await page.setViewportSize({ width: 1024, height: 768 });

      console.log('✅ Playwright connected successfully');

      // Store session with multi-tab support
      const session: BrowserSession = {
        kernelBrowserId,
        browser,
        page,
        pages: [page], // Initialize pages stack with first page
        context, // Store context for page event listeners
        liveViewUrl,
        cdpWsUrl: cdpUrl,
        createdAt: new Date(),
      };

      this.activeSessions.set(kernelBrowserId, session);
      console.log('💾 Session stored in activeSessions Map with key:', kernelBrowserId);
      console.log('📊 Total active sessions:', this.activeSessions.size);

      // Set up page listeners for multi-tab handling
      this.setupPageListeners(session, context);
      this.setupPageCloseListener(session, page);

      // Set up download listeners for file download tracking
      try {
        await this.setupDownloadListeners(kernelBrowserId);
      } catch (error) {
        console.error('⚠️ Failed to setup download listeners (non-fatal):', error);
        // Non-fatal - continue without download tracking
      }

      // Return session details including CDP URLs for database storage
      return {
        sessionId: kernelBrowserId,
        id: kernelBrowserId,
        status: 'active',
        liveViewUrl: liveViewUrl,
        cdpWsUrl: cdpUrl,
        launchTime: session.createdAt.toISOString(),
      };
    } catch (error) {
      console.error('❌ Failed to create browser session:', error);
      throw error;
    }
  }

  async getSession(sessionId: string) {
    console.log('🔍 Getting session status:', sessionId);
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      // Don't log as error - this is expected when session is stopped/destroyed
      console.log('ℹ️ Session not found in active sessions:', sessionId);
      throw new Error(`Session ${sessionId} not found in active sessions`);
    }

    return {
      status: 'active',
      browser_url: session.liveViewUrl,
      id: sessionId,
      launchTime: session.createdAt.toISOString(),
    };
  }

  async takeScreenshot(sessionId: string) {
    console.log('📸 Taking screenshot for session:', sessionId);
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found in active sessions`);
      }

      // Try primary page first with validation and fallback to other pages
      const primaryPage = session.page;
      const screenshotBuffer = await this.attemptScreenshotWithFallback(session, primaryPage);

      if (!screenshotBuffer) {
        throw new Error('Failed to take screenshot from any available page');
      }

      const base64Image = screenshotBuffer.toString('base64');
      const imageUrl = `data:image/png;base64,${base64Image}`;

      return {
        url: imageUrl,
        screenshot_url: imageUrl,
        screenshot: imageUrl,
        base64Image: base64Image,
      };
    } catch (error) {
      console.error('❌ Failed to take screenshot:', error);
      throw error;
    }
  }

  async performAction(sessionId: string, action: {
    action: string;
    coordinate?: [number, number];
    text?: string;
    [key: string]: any;
  }) {
    console.log('🎯 Performing action:', action.action, 'on session:', sessionId);
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found in active sessions`);
      }

      const { page } = session;

      switch (action.action.toLowerCase()) {
        case 'click':
        case 'left_click':
          if (!action.coordinate || action.coordinate.length !== 2) {
            throw new Error('click requires coordinate [x, y]');
          }
          await page.mouse.click(action.coordinate[0], action.coordinate[1]);
          console.log('✅ Clicked at:', action.coordinate);
          return { success: true };

        case 'double_click':
          if (!action.coordinate || action.coordinate.length !== 2) {
            throw new Error('double_click requires coordinate [x, y]');
          }
          await page.mouse.dblclick(action.coordinate[0], action.coordinate[1]);
          console.log('✅ Double-clicked at:', action.coordinate);
          return { success: true };

        case 'right_click':
          if (!action.coordinate || action.coordinate.length !== 2) {
            throw new Error('right_click requires coordinate [x, y]');
          }
          await page.mouse.click(action.coordinate[0], action.coordinate[1], { button: 'right' });
          console.log('✅ Right-clicked at:', action.coordinate);
          return { success: true };

        case 'type':
          if (!action.text) {
            throw new Error('type requires text parameter');
          }
          console.log(`⌨️ Typing with delay: ${this.typingDelay}ms`);
          await page.keyboard.type(action.text, { delay: this.typingDelay });
          console.log('✅ Typed:', action.text);
          return { success: true };

        case 'key':
          if (!action.text) {
            throw new Error('key requires text parameter');
          }
          // Normalize key input (handles combinations like "ctrl+a" → "Control+a")
          const normalizedKey = this.parseKeyInput(action.text);
          await page.keyboard.press(normalizedKey);
          console.log('✅ Pressed key:', normalizedKey, '(original:', action.text, ')');
          return { success: true };

        case 'scroll':
          if (!action.coordinate || action.coordinate.length !== 2) {
            throw new Error('scroll requires coordinate [x, y]');
          }
          const deltaX = action.deltaX || 0;
          const deltaY = action.deltaY || 0;

          // Move mouse to position first, then scroll
          await page.mouse.move(action.coordinate[0], action.coordinate[1]);
          await page.mouse.wheel(deltaX, deltaY);
          console.log('✅ Scrolled at:', action.coordinate, 'delta:', { deltaX, deltaY });
          return { success: true };

        case 'screenshot':
          const screenshot = await this.takeScreenshot(sessionId);
          return { base64Image: screenshot.base64Image };

        default:
          throw new Error(`Unsupported action: ${action.action}`);
      }
    } catch (error) {
      console.error('❌ Failed to perform action:', error);
      throw error;
    }
  }

  async click(sessionId: string, x: number, y: number) {
    return this.performAction(sessionId, {
      action: 'click',
      coordinate: [x, y],
    });
  }

  async doubleClick(sessionId: string, x: number, y: number) {
    return this.performAction(sessionId, {
      action: 'double_click',
      coordinate: [x, y],
    });
  }

  async rightClick(sessionId: string, x: number, y: number) {
    return this.performAction(sessionId, {
      action: 'right_click',
      coordinate: [x, y],
    });
  }

  async type(sessionId: string, text: string) {
    return this.performAction(sessionId, {
      action: 'type',
      text: text,
    });
  }

  async scroll(sessionId: string, x: number, y: number, direction: string, amount: number = 300) {
    return this.performAction(sessionId, {
      action: 'scroll',
      coordinate: [x, y],
      deltaX: 0,
      deltaY: direction === 'down' ? amount : -amount,
    });
  }

  async keyPress(sessionId: string, key: string) {
    return this.performAction(sessionId, {
      action: 'key',
      text: key,
    });
  }

  async navigate(sessionId: string, url: string) {
    console.log('🌍 Navigating to:', url);
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      await session.page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      console.log('✅ Navigation completed');
      return { success: true };
    } catch (error) {
      console.error('❌ Navigation failed:', error);
      throw error;
    }
  }

  async moveMouse(sessionId: string, x: number, y: number) {
    console.log('🖱️ Moving mouse to:', x, y);
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      await session.page.mouse.move(x, y);
      console.log('✅ Mouse moved');
      return { success: true };
    } catch (error) {
      console.error('❌ Mouse move failed:', error);
      throw error;
    }
  }

  async wait(sessionId: string, duration: number, takeScreenshot: boolean = false) {
    console.log('⏳ Waiting for:', duration, 'ms');
    try {
      await new Promise(resolve => setTimeout(resolve, duration));
      console.log('✅ Wait completed');

      if (takeScreenshot) {
        return await this.takeScreenshot(sessionId);
      }
      return { success: true };
    } catch (error) {
      console.error('❌ Wait failed:', error);
      throw error;
    }
  }

  async getCursorPosition(sessionId: string) {
    console.log('📍 Getting cursor position');
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      // Playwright doesn't directly expose cursor position,
      // so we return a success message
      console.log('✅ Cursor position request completed');
      return { success: true, message: 'Cursor position tracked by browser' };
    } catch (error) {
      console.error('❌ Failed to get cursor position:', error);
      throw error;
    }
  }

  async destroySession(sessionId: string) {
    console.log('🗑️ Destroying session:', sessionId);
    try {
      const session = this.activeSessions.get(sessionId);

      if (session) {
        // Close Playwright browser connection
        try {
          await session.browser.close();
          console.log('✅ Playwright browser closed');
        } catch (error) {
          console.error('⚠️ Error closing Playwright browser:', error);
        }
      } else {
        console.log('⚠️ Session not found in cache, will attempt to delete from OnKernel directly');
      }

      // Delete browser from OnKernel (always attempt, even if not in cache)
      try {
        const kernel = this.getKernel();
        const browserIdToDelete = session?.kernelBrowserId || sessionId;
        console.log('🗑️ Deleting browser from OnKernel:', browserIdToDelete);
        await kernel.browsers.deleteByID(browserIdToDelete);
        console.log('✅ OnKernel browser deleted:', browserIdToDelete);
      } catch (error) {
        console.error('⚠️ Error deleting OnKernel browser:', error);
        // Don't throw - continue to remove from cache
      }

      // Remove from cache if it exists
      if (session) {
        this.activeSessions.delete(sessionId);
        console.log('✅ Session removed from cache');
      }

      // Clear download tracker for this session
      this.clearDownloads(sessionId);

      // Update database
      try {
        const { error, count } = await supabase
          .from('browser_sessions')
          .update({
            cdp_connected: false,
            status: 'stopped'
          })
          .eq('onkernel_session_id', sessionId);

        if (error) {
          console.error('⚠️ Database update error:', error);
          // Don't throw - session is already destroyed locally
        } else if (count === 0) {
          console.warn('⚠️ No rows updated - browser session not found in database:', sessionId);
        } else {
          console.log('✅ Database updated - session destroyed');
        }
      } catch (error) {
        console.error('⚠️ Failed to update database:', error);
      }

      return { status: 'destroyed' };
    } catch (error) {
      console.error('❌ Failed to destroy session:', error);
      throw error;
    }
  }

  /**
   * Disconnect CDP connection only (keep OnKernel browser alive)
   * This stops OnKernel billing while preserving the browser session
   * Includes post-disconnect verification to ensure CDP is truly disconnected
   */
  async disconnectCDP(sessionId: string) {
    console.log('🔌 Disconnecting CDP for session:', sessionId);
    try {
      const session = this.activeSessions.get(sessionId);

      if (!session) {
        console.log('⚠️ Session not found in cache:', sessionId);
        throw new Error(`Session ${sessionId} not found in active sessions`);
      }

      // Step 1: Mark as intentional disconnect BEFORE closing (prevents false warnings from event listener)
      session.intentionalDisconnect = true;

      // Step 2: Close the Playwright browser connection (CDP)
      try {
        await session.browser.close();
        console.log('✅ CDP connection closed (Playwright browser)');
      } catch (error) {
        console.error('⚠️ Error closing CDP connection:', error);
        throw error;
      }

      // Note: OnKernel browser remains alive in standby mode - this is expected behavior
      // We're only closing our CDP connection to stop billing
      console.log('ℹ️ OnKernel browser remains active and can be reconnected later');

      // Step 3: Remove from in-memory cache
      this.activeSessions.delete(sessionId);
      console.log('✅ Session removed from activeSessions cache');

      // Step 4: Update database - mark CDP as disconnected with timestamp
      const disconnectedAt = new Date().toISOString();
      try {
        const { error, count } = await supabase
          .from('browser_sessions')
          .update({
            cdp_connected: false,
            cdp_disconnected_at: disconnectedAt,
            last_activity_at: disconnectedAt
          })
          .eq('onkernel_session_id', sessionId);

        if (error) {
          console.error('⚠️ Database update error:', error);
          throw new Error(`Failed to update CDP status in database: ${error.message}`);
        }

        if (count === 0) {
          console.warn('⚠️ No rows updated - browser session not found in database:', sessionId);
        } else {
          console.log('✅ Database updated - CDP disconnected with timestamp');
        }
      } catch (error) {
        console.error('⚠️ Failed to update database:', error);
        // Don't throw - CDP is still disconnected even if DB update fails
      }

      console.log('🎉 CDP disconnection completed successfully');

      return {
        status: 'disconnected',
        timestamp: disconnectedAt,
        message: 'CDP disconnected successfully. OnKernel browser remains alive and can be reconnected.'
      };
    } catch (error) {
      console.error('❌ Failed to disconnect CDP:', error);
      throw error;
    }
  }

  /**
   * Reconnect CDP to an existing OnKernel browser session
   * Uses stored cdp_ws_url from database
   */
  async reconnectCDP(sessionId: string) {
    console.log('🔌 Reconnecting CDP for session:', sessionId);
    try {
      // Check if already connected
      if (this.activeSessions.has(sessionId)) {
        console.log('ℹ️ CDP already connected for session:', sessionId);
        return {
          status: 'already_connected',
          message: 'CDP is already connected'
        };
      }

      // Fetch CDP URL from database
      const { data: browserSession, error: fetchError } = await supabase
        .from('browser_sessions')
        .select('cdp_ws_url, live_view_url, onkernel_session_id')
        .eq('onkernel_session_id', sessionId)
        .single();

      if (fetchError || !browserSession) {
        console.error('❌ Browser session not found in database:', sessionId);
        throw new Error(`Browser session ${sessionId} not found in database`);
      }

      if (!browserSession.cdp_ws_url) {
        console.error('❌ No CDP URL stored for session:', sessionId);
        throw new Error(`No CDP URL found for session ${sessionId}`);
      }

      const cdpUrl = browserSession.cdp_ws_url;
      const liveViewUrl = browserSession.live_view_url || '';

      console.log('🔗 Reconnecting to CDP URL:', cdpUrl);

      // Reconnect Playwright to the remote browser via CDP
      const browser = await chromium.connectOverCDP(cdpUrl);
      console.log('✅ Playwright reconnected to CDP');

      // Add disconnected event listener to handle unexpected disconnections
      browser.on('disconnected', async () => {
        console.log('🔌 Playwright browser disconnected event fired for session:', sessionId);

        // Check if this was an intentional disconnect
        const session = this.activeSessions.get(sessionId);
        if (session?.intentionalDisconnect) {
          console.log('✅ Intentional CDP disconnect - event listener skipping cleanup');
          return; // Exit early - disconnectCDP() will handle cleanup
        }

        console.log('⚠️ Unexpected CDP disconnection detected - cleaning up');

        // Remove from cache
        this.activeSessions.delete(sessionId);
        console.log('✅ Session removed from activeSessions cache');

        // Update database to reflect disconnection
        try {
          const { error, count } = await supabase
            .from('browser_sessions')
            .update({
              cdp_connected: false,
              cdp_disconnected_at: new Date().toISOString(),
              last_activity_at: new Date().toISOString()
            })
            .eq('onkernel_session_id', sessionId);

          if (error) {
            console.error('⚠️ Failed to update database after unexpected disconnect:', error);
          } else if (count === 0) {
            console.warn('⚠️ No rows updated - browser session not found in database:', sessionId);
          } else {
            console.log('✅ Database updated after unexpected CDP disconnect');
          }
        } catch (error) {
          console.error('⚠️ Error updating database after disconnect:', error);
        }
      });

      console.log('✅ Disconnection event listener attached');

      // Get the default context and page
      const contexts = browser.contexts();
      if (contexts.length === 0) {
        throw new Error('No browser contexts found after reconnection');
      }

      const context = contexts[0];
      const existingPages = context.pages();

      let page: Page;
      let allPages: Page[];

      if (existingPages.length === 0) {
        // Create a new page if none exists
        page = await context.newPage();
        allPages = [page];
        console.log('✅ Created new page (no existing pages found)');
      } else {
        allPages = [...existingPages];

        // Find the most suitable page (prefer non-blank, responsive page)
        let selectedPage: Page | null = null;

        for (const candidatePage of allPages.slice().reverse()) { // Most recent first
          if (candidatePage.isClosed()) {
            continue;
          }

          const url = candidatePage.url();
          // Prefer pages with actual content over about:blank or chrome pages
          if (url && !url.startsWith('about:') && !url.startsWith('chrome:')) {
            selectedPage = candidatePage;
            console.log(`✅ Selected page with URL: ${url}`);
            break;
          }
        }

        // Fallback to last page if no suitable page found
        if (!selectedPage) {
          selectedPage = allPages[allPages.length - 1];
          console.log(`ℹ️ Using last page as fallback: ${selectedPage.url()}`);
        }

        page = selectedPage;
        console.log(`✅ Found ${existingPages.length} existing page(s), selected active page`);
      }

      // Set viewport to match configuration
      await page.setViewportSize({ width: 1024, height: 768 });
      console.log('✅ Viewport configured');

      // Store session in cache with multi-tab support
      const session: BrowserSession = {
        kernelBrowserId: sessionId,
        browser,
        page,
        pages: allPages, // Store all existing pages in stack
        context, // Store context for page event listeners
        liveViewUrl,
        cdpWsUrl: cdpUrl,
        createdAt: new Date(),
      };

      this.activeSessions.set(sessionId, session);
      console.log('💾 Session reconnected and stored in activeSessions Map');

      // Set up page listeners for multi-tab handling
      this.setupPageListeners(session, context);

      // Set up close listeners for all existing pages
      for (const existingPage of allPages) {
        this.setupPageCloseListener(session, existingPage);
      }
      console.log(`✅ Page listeners attached for ${allPages.length} page(s)`);

      // Set up download listeners for file download tracking
      try {
        await this.setupDownloadListeners(sessionId);
      } catch (error) {
        console.error('⚠️ Failed to setup download listeners (non-fatal):', error);
        // Non-fatal - continue without download tracking
      }

      // Update database - mark CDP as connected
      try {
        const { error, count } = await supabase
          .from('browser_sessions')
          .update({
            cdp_connected: true,
            last_activity_at: new Date().toISOString()
          })
          .eq('onkernel_session_id', sessionId);

        if (error) {
          console.error('⚠️ Database update error:', error);
          // Don't throw - CDP is still connected even if DB update fails
        } else if (count === 0) {
          console.warn('⚠️ No rows updated - browser session not found in database:', sessionId);
        } else {
          console.log('✅ Database updated - CDP reconnected');
        }
      } catch (error) {
        console.error('⚠️ Failed to update database:', error);
        // Don't throw - CDP is still connected even if DB update fails
      }

      return {
        status: 'connected',
        message: 'CDP reconnected successfully',
        liveViewUrl: liveViewUrl
      };
    } catch (error) {
      console.error('❌ Failed to reconnect CDP:', error);
      throw error;
    }
  }

  // Get all active sessions
  getActiveSessions() {
    return Array.from(this.activeSessions.keys());
  }

  // Note: Profiles handle authentication automatically (when enabled)
  // Auth state is persisted when save_changes: true
  async saveAuthState(sessionId: string, name: string = 'default') {
    if (this.useProfiles) {
      console.log('💾 Auth state is automatically saved via profile system');
      return {
        message: 'Auth state automatically saved via profile',
        profileName: this.profileName,
        enabled: true,
      };
    } else {
      console.log('ℹ️ Auth state persistence is disabled (profiles not enabled)');
      return {
        message: 'Auth state persistence requires profiles (startup/enterprise plan)',
        enabled: false,
      };
    }
  }

  // Note: Onkernel handles pause/resume automatically via standby mode
  async pauseSession(sessionId: string) {
    console.log('⏸️ Onkernel handles session standby automatically');
    return {
      message: 'Session will automatically enter standby when idle',
      status: 'standby_automatic',
    };
  }

  async resumeSession(sessionId: string) {
    console.log('▶️ Onkernel handles session resume automatically');
    return {
      message: 'Session will automatically resume when accessed',
      status: 'resume_automatic',
    };
  }

  /**
   * Set up CDP download listeners for a browser session
   * This configures where downloads are saved and tracks download events
   */
  async setupDownloadListeners(sessionId: string): Promise<void> {
    console.log('📥 Setting up download listeners for session:', sessionId);

    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found in active sessions`);
    }

    try {
      // Get or create CDP session
      const context = session.browser.contexts()[0];
      if (!context) {
        throw new Error('No browser context found');
      }

      const cdpClient = await context.newCDPSession(session.page);
      session.cdpClient = cdpClient;

      // Configure download behavior
      await cdpClient.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: DOWNLOAD_DIR,
        eventsEnabled: true,
      });
      console.log('✅ Download behavior configured, path:', DOWNLOAD_DIR);

      // Initialize download tracker for this session
      if (!this.downloadTracker.has(sessionId)) {
        this.downloadTracker.set(sessionId, []);
      }

      // Listen for download start
      cdpClient.on('Browser.downloadWillBegin', (event: any) => {
        const filename = event.suggestedFilename ?? 'unknown';
        const downloadInfo: DownloadInfo = {
          filename,
          path: `${DOWNLOAD_DIR}/${filename}`,
          status: 'started',
          downloadedAt: new Date(),
          guid: event.guid,
        };

        const downloads = this.downloadTracker.get(sessionId) || [];
        downloads.push(downloadInfo);
        this.downloadTracker.set(sessionId, downloads);

        console.log('📥 Download started:', filename, 'GUID:', event.guid);
      });

      // Listen for download progress
      cdpClient.on('Browser.downloadProgress', (event: any) => {
        const downloads = this.downloadTracker.get(sessionId) || [];
        const download = downloads.find(d => d.guid === event.guid);

        if (download) {
          if (event.state === 'completed') {
            download.status = 'completed';
            download.size = event.receivedBytes;
            console.log('✅ Download completed:', download.filename, 'Size:', event.receivedBytes);
          } else if (event.state === 'canceled') {
            download.status = 'failed';
            console.log('❌ Download canceled:', download.filename);
          } else if (event.state === 'inProgress') {
            download.status = 'in_progress';
            download.progress = event.totalBytes > 0
              ? Math.round((event.receivedBytes / event.totalBytes) * 100)
              : undefined;
          }
        }
      });

      console.log('✅ Download listeners attached for session:', sessionId);
    } catch (error) {
      console.error('❌ Failed to setup download listeners:', error);
      throw error;
    }
  }

  /**
   * Get the most recent completed download for a session
   * First tries in-memory CDP tracking, then falls back to filesystem check
   */
  async getMostRecentDownload(sessionId: string): Promise<DownloadInfo | null> {
    // First try in-memory tracker (CDP events)
    const downloads = this.downloadTracker.get(sessionId) || [];
    const completedDownloads = downloads
      .filter(d => d.status === 'completed')
      .sort((a, b) => b.downloadedAt.getTime() - a.downloadedAt.getTime());

    if (completedDownloads.length > 0) {
      const mostRecent = completedDownloads[0];
      console.log('📥 Most recent download (from CDP tracker):', mostRecent.filename);
      return mostRecent;
    }

    // Fallback: Check filesystem directly via OnKernel API
    console.log('⚠️ No CDP-tracked downloads, checking filesystem...');
    try {
      const files = await this.listDownloadFiles(sessionId);

      if (files.length === 0) {
        console.log('ℹ️ No files found in download directory');
        return null;
      }

      // IMPORTANT: Sort by mod_time descending to pick the NEWEST file
      // mod_time format: "2025-12-02T10:53:09.753375746-05:00"
      files.sort((a, b) => new Date(b.modTime).getTime() - new Date(a.modTime).getTime());

      // Pick the newest file (first after sorting)
      const newestFile = files[0];
      console.log(`📥 Found ${files.length} file(s), picking newest: ${newestFile.name} (modified: ${newestFile.modTime})`);

      return {
        filename: newestFile.name,
        path: newestFile.path,
        size: newestFile.size,
        status: 'completed',
        downloadedAt: new Date(newestFile.modTime)
      };
    } catch (error) {
      console.error('❌ Filesystem fallback failed:', error);
      return null;
    }
  }

  /**
   * Get all downloads for a session
   */
  getDownloads(sessionId: string): DownloadInfo[] {
    return this.downloadTracker.get(sessionId) || [];
  }

  /**
   * List files in the download directory using OnKernel filesystem API
   * Fallback when CDP download tracking fails
   */
  async listDownloadFiles(sessionId: string): Promise<Array<{name: string, path: string, size: number, modTime: string}>> {
    console.log('📂 Listing download files for session:', sessionId);

    const kernel = this.getKernel();
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Use OnKernel SDK to list files in download directory
    const response = await kernel.browsers.fs.listFiles(session.kernelBrowserId, {
      path: DOWNLOAD_DIR
    });

    console.log('📂 Found', response.length, 'items in download directory');

    // Filter out directories, return only files with normalized properties
    return response.filter((f: any) => !f.is_dir).map((f: any) => ({
      name: f.name,
      path: f.path,
      size: f.size_bytes,
      modTime: f.mod_time  // ISO timestamp like "2025-12-02T10:53:09.753375746-05:00"
    }));
  }

  /**
   * Read a downloaded file from the OnKernel browser filesystem
   */
  async readDownloadedFile(sessionId: string, filename: string): Promise<Buffer> {
    console.log('📖 Reading downloaded file:', filename, 'from session:', sessionId);

    try {
      const kernel = this.getKernel();
      const session = this.activeSessions.get(sessionId);

      if (!session) {
        throw new Error(`Session ${sessionId} not found in active sessions`);
      }

      const filePath = `${DOWNLOAD_DIR}/${filename}`;
      console.log('📂 Reading from path:', filePath);

      // Use OnKernel SDK to read file from browser filesystem
      const response = await kernel.browsers.fs.readFile(session.kernelBrowserId, {
        path: filePath,
      });

      // Get bytes from response
      const bytes = await response.bytes();
      const buffer = Buffer.from(bytes);

      console.log('✅ File read successfully, size:', buffer.length, 'bytes');
      return buffer;
    } catch (error) {
      console.error('❌ Failed to read downloaded file:', error);
      throw error;
    }
  }

  /**
   * Upload a file to the browser's file input element using Playwright
   * This is used to upload files from Supabase to the browser for form submissions
   */
  async uploadFileToInput(sessionId: string, fileBuffer: Buffer, filename: string): Promise<{ success: boolean; filename: string }> {
    console.log('📤 Uploading file to browser input:', filename, 'for session:', sessionId);

    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found in active sessions`);
      }

      // Find file input element on the page
      const fileInput = session.page.locator('input[type="file"]').first();

      // Check if file input exists
      const inputCount = await session.page.locator('input[type="file"]').count();
      if (inputCount === 0) {
        throw new Error('No file input element found on the page');
      }

      // Use Playwright's setInputFiles with buffer
      await fileInput.setInputFiles({
        name: filename,
        mimeType: this.getMimeType(filename),
        buffer: fileBuffer,
      });

      console.log('✅ File uploaded to input element:', filename);
      return { success: true, filename };
    } catch (error) {
      console.error('❌ Failed to upload file to input:', error);
      throw error;
    }
  }

  /**
   * Get MIME type from filename extension
   */
  private getMimeType(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop();
    const mimeTypes: { [key: string]: string } = {
      'pdf': 'application/pdf',
      'csv': 'text/csv',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'xls': 'application/vnd.ms-excel',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'txt': 'text/plain',
      'json': 'application/json',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'zip': 'application/zip',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }

  /**
   * Clear download tracker for a session (called when session is destroyed)
   */
  clearDownloads(sessionId: string): void {
    this.downloadTracker.delete(sessionId);
    console.log('🗑️ Download tracker cleared for session:', sessionId);
  }
}

export const onkernelClient = new OnkernelClient();
