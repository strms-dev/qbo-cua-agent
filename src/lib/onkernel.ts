import { Kernel } from '@onkernel/sdk';
import { chromium, Browser, Page } from 'playwright';

interface BrowserSession {
  kernelBrowserId: string;
  browser: Browser;
  page: Page;
  liveViewUrl: string;
  createdAt: Date;
}

export class OnkernelClient {
  private kernel: Kernel | null = null;
  private activeSessions: Map<string, BrowserSession> = new Map();
  private profileName: string = 'qbo-auth';
  private useProfiles: boolean = false; // Set to true when you upgrade to startup/enterprise plan
  private typingDelay: number;

  constructor() {
    // Kernel client will be initialized lazily to avoid build-time issues
    // Check environment variable to enable profiles
    this.useProfiles = process.env.ONKERNEL_USE_PROFILES === 'true';

    // Configure typing delay from environment variable (default: 5ms)
    const delayEnv = process.env.TYPING_DELAY_MS;
    const parsedDelay = delayEnv ? parseInt(delayEnv, 10) : 5;
    this.typingDelay = (!isNaN(parsedDelay) && parsedDelay >= 0) ? parsedDelay : 5;

    console.log('🔧 OnkernelClient initialized:');
    console.log('  - TYPING_DELAY_MS env var:', delayEnv);
    console.log('  - Parsed delay value:', parsedDelay);
    console.log('  - Final typing delay:', this.typingDelay, 'ms');
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

  async createSession() {
    console.log('🔄 Creating new browser session with Onkernel...');
    try {
      const kernel = this.getKernel();

      // Build browser creation options
      const browserOptions: any = {
        timeout_seconds: 600, // 10 minutes
        stealth: true, // Enable stealth mode for better compatibility
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

      // Create browser with Onkernel
      // Reference: https://docs.onkernel.com/api-reference/browsers/create-a-browser-session
      const kernelBrowser = await kernel.browsers.create(browserOptions);

      // Debug: Log full Onkernel API response for troubleshooting
      console.log('🔍 Onkernel API Response:', JSON.stringify(kernelBrowser, null, 2));

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
      await page.setViewportSize({ width: 1280, height: 800 });

      console.log('✅ Playwright connected successfully');

      // Store session
      const session: BrowserSession = {
        kernelBrowserId,
        browser,
        page,
        liveViewUrl,
        createdAt: new Date(),
      };

      this.activeSessions.set(kernelBrowserId, session);
      console.log('💾 Session stored in activeSessions Map with key:', kernelBrowserId);
      console.log('📊 Total active sessions:', this.activeSessions.size);

      return {
        sessionId: kernelBrowserId,
        id: kernelBrowserId,
        status: 'active',
        liveViewUrl: liveViewUrl,
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
      if (!session) {
        console.log('⚠️ Session not found in cache, may already be stopped');
        return { status: 'not_found' };
      }

      // Close Playwright browser connection
      try {
        await session.browser.close();
        console.log('✅ Playwright browser closed');
      } catch (error) {
        console.error('⚠️ Error closing Playwright browser:', error);
      }

      // Delete browser from Onkernel
      try {
        const kernel = this.getKernel();
        await kernel.browsers.deleteByID(session.kernelBrowserId);
        console.log('✅ Onkernel browser deleted');
      } catch (error) {
        console.error('⚠️ Error deleting Onkernel browser:', error);
      }

      // Remove from cache
      this.activeSessions.delete(sessionId);

      return { status: 'destroyed' };
    } catch (error) {
      console.error('❌ Failed to destroy session:', error);
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
