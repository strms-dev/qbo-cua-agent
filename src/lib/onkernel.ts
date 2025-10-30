import { Kernel } from '@onkernel/sdk';
import { chromium, Browser, Page } from 'playwright';
import { supabase } from './supabase';

interface BrowserSession {
  kernelBrowserId: string;
  browser: Browser;
  page: Page;
  liveViewUrl: string;
  cdpWsUrl: string;
  createdAt: Date;
  intentionalDisconnect?: boolean; // Track intentional CDP disconnections to avoid false warnings
}

export class OnkernelClient {
  private kernel: Kernel | null = null;
  private activeSessions: Map<string, BrowserSession> = new Map();
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
        }
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

      // Store session
      const session: BrowserSession = {
        kernelBrowserId,
        browser,
        page,
        liveViewUrl,
        cdpWsUrl: cdpUrl,
        createdAt: new Date(),
      };

      this.activeSessions.set(kernelBrowserId, session);
      console.log('💾 Session stored in activeSessions Map with key:', kernelBrowserId);
      console.log('📊 Total active sessions:', this.activeSessions.size);

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

      const screenshotBuffer = await session.page.screenshot({
        type: 'png',
        fullPage: false, // Only visible viewport
      });

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
          // Map common key names to Playwright key names
          const keyMap: { [key: string]: string } = {
            'Return': 'Enter',
            'return': 'Enter',
            'Backspace': 'Backspace',
            'Tab': 'Tab',
            'Escape': 'Escape',
            'Delete': 'Delete',
            'ArrowUp': 'ArrowUp',
            'ArrowDown': 'ArrowDown',
            'ArrowLeft': 'ArrowLeft',
            'ArrowRight': 'ArrowRight',
          };
          const key = keyMap[action.text] || action.text;
          await page.keyboard.press(key);
          console.log('✅ Pressed key:', key);
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
      const pages = context.pages();

      let page;
      if (pages.length === 0) {
        // Create a new page if none exists
        page = await context.newPage();
      } else {
        page = pages[0];
      }

      // Set viewport to match configuration
      await page.setViewportSize({ width: 1024, height: 768 });
      console.log('✅ Viewport configured');

      // Store session in cache
      const session: BrowserSession = {
        kernelBrowserId: sessionId,
        browser,
        page,
        liveViewUrl,
        cdpWsUrl: cdpUrl,
        createdAt: new Date(),
      };

      this.activeSessions.set(sessionId, session);
      console.log('💾 Session reconnected and stored in activeSessions Map');

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
}

export const onkernelClient = new OnkernelClient();
