import { ScrapybaraClient as ScrapybaraSDK, BrowserInstance } from 'scrapybara';

export class ScrapybaraClient {
  private sdk: ScrapybaraSDK;
  private activeSessions: Map<string, BrowserInstance> = new Map();

  constructor() {
    this.sdk = new ScrapybaraSDK({
      apiKey: process.env.SCRAPYBARA_API_KEY!,
    });
  }

  async createSession() {
    console.log('🔄 Creating new browser session with official SDK...');
    try {
      const timeoutHours = parseFloat(process.env.SCRAPYBARA_TIMEOUT_HOURS || '0.01');
      const browserInstance = await this.sdk.startBrowser({
        resolution: [1280, 800], // Match Anthropic computer tool dimensions
        timeout_hours: timeoutHours,
      });

      const sessionId = browserInstance.id;
      this.activeSessions.set(sessionId, browserInstance);

      console.log('✅ Browser session created:', sessionId);

      // Authenticate with saved QBO auth state if configured
      const authStateId = process.env.SCRAPYBARA_AUTH_STATE_ID;
      if (authStateId) {
        try {
          console.log('🔐 Authenticating with saved auth state:', authStateId);
          await browserInstance.authenticate({
            authStateId: authStateId
          });
          console.log('✅ Authentication successful - browser is now logged in');
        } catch (authError: any) {
          console.error('⚠️ Failed to authenticate with saved auth state:', authError?.message || authError);
          console.error('💡 Make sure the auth state exists on your Scrapybara account');
          console.error('💡 You can create it by logging in once and calling saveAuth()');
          // Continue without authentication - user will need to login manually
        }
      } else {
        console.log('ℹ️ No SCRAPYBARA_AUTH_STATE_ID configured - skipping authentication');
      }

      return {
        sessionId: sessionId,
        id: sessionId,
        status: browserInstance.status,
        launchTime: browserInstance.launchTime,
      };
    } catch (error) {
      console.error('❌ Failed to create browser session:', error);
      throw error;
    }
  }

  async getSession(sessionId: string) {
    console.log('🔍 Getting session status:', sessionId);
    try {
      // Always fetch fresh from SDK to get current status (no stale cache)
      const instance = await this.sdk.get(sessionId);

      if (instance instanceof Object && 'id' in instance) {
        const browserInstance = instance as BrowserInstance;

        // Update cache with fresh instance
        this.activeSessions.set(sessionId, browserInstance);

        return {
          status: browserInstance.status,
          browser_url: await this.getStreamUrl(browserInstance),
          id: browserInstance.id,
          launchTime: browserInstance.launchTime,
        };
      } else {
        throw new Error('Session not found or invalid type');
      }
    } catch (error) {
      console.error('❌ Failed to get session:', error);
      throw error;
    }
  }

  async takeScreenshot(sessionId: string) {
    console.log('📸 Taking screenshot for session:', sessionId);
    try {
      const browserInstance = this.activeSessions.get(sessionId);
      if (!browserInstance) {
        throw new Error(`Session ${sessionId} not found in active sessions`);
      }

      const screenshotResponse = await browserInstance.screenshot();

      // Convert base64 to data URL
      const imageUrl = `data:image/png;base64,${screenshotResponse.base64Image}`;

      return {
        url: imageUrl,
        screenshot_url: imageUrl,
        screenshot: imageUrl,
        base64Image: screenshotResponse.base64Image,
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
      const browserInstance = this.activeSessions.get(sessionId);
      if (!browserInstance) {
        throw new Error(`Session ${sessionId} not found in active sessions`);
      }

      // Map our action types to SDK action types
      let computerRequest: any;

      switch (action.action.toLowerCase()) {
        case 'click':
          computerRequest = {
            action: 'click_mouse' as const,
            coordinates: action.coordinate, // Scrapybara uses 'coordinates' (plural)
            button: 'left', // Required parameter for click actions
          };
          break;
        case 'double_click':
          computerRequest = {
            action: 'click_mouse' as const,
            coordinates: action.coordinate,
            button: 'left',
            num_clicks: 2, // Use Scrapybara's built-in double-click
          };
          break;
        case 'right_click':
          computerRequest = {
            action: 'click_mouse' as const,
            coordinates: action.coordinate,
            button: 'right', // Use Scrapybara's built-in right-click
          };
          break;
        case 'type':
          computerRequest = {
            action: 'type_text' as const,
            text: action.text || '',
          };
          break;
        case 'scroll':
          computerRequest = {
            action: 'scroll' as const,
            coordinates: action.coordinate, // Scrapybara uses 'coordinates' (plural)
          };
          break;
        case 'key':
          computerRequest = {
            action: 'press_key' as const,
            keys: [action.text || ''], // Keys should be an array
          };
          break;
        case 'screenshot':
          computerRequest = {
            action: 'take_screenshot' as const,
          };
          break;
        default:
          throw new Error(`Unsupported action: ${action.action}`);
      }

      const computerResponse = await browserInstance.computer(computerRequest);

      // Truncate base64Image for logging
      const logResponse = computerResponse.base64Image
        ? {
            ...computerResponse,
            base64Image: computerResponse.base64Image.substring(0, 100) + '...'
          }
        : computerResponse;

      console.log('✅ Action completed:', logResponse);
      return computerResponse;
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

  async scroll(sessionId: string, direction: string, amount: number = 300) {
    return this.performAction(sessionId, {
      action: 'scroll',
      coordinate: direction === 'down' ? [0, amount] : [0, -amount],
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
    return this.performAction(sessionId, {
      action: 'type',
      text: url,
      coordinate: [400, 50], // Address bar location
    });
  }

  async moveMouse(sessionId: string, x: number, y: number) {
    console.log('🖱️ Moving mouse to:', x, y);
    const browserInstance = this.activeSessions.get(sessionId);
    if (!browserInstance) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const computerResponse = await browserInstance.computer({
      action: 'move_mouse' as const,
      coordinates: [x, y],
    });

    console.log('✅ Mouse moved:', computerResponse);
    return computerResponse;
  }

  async wait(sessionId: string, duration: number, takeScreenshot: boolean = false) {
    console.log('⏳ Waiting for:', duration, 'ms');
    const browserInstance = this.activeSessions.get(sessionId);
    if (!browserInstance) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const computerResponse = await browserInstance.computer({
      action: 'wait' as const,
      duration: duration,
      screenshot: takeScreenshot,
    });

    console.log('✅ Wait completed');
    return computerResponse;
  }

  async getCursorPosition(sessionId: string) {
    console.log('📍 Getting cursor position');
    const browserInstance = this.activeSessions.get(sessionId);
    if (!browserInstance) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const computerResponse = await browserInstance.computer({
      action: 'get_cursor_position' as const,
    });

    console.log('✅ Got cursor position:', computerResponse);
    return computerResponse;
  }

  private async getStreamUrl(browserInstance: BrowserInstance) {
    try {
      const streamResponse = await browserInstance.getStreamUrl();
      return streamResponse.streamUrl;
    } catch (error) {
      console.error('⚠️ Failed to get stream URL:', error);
      return null;
    }
  }

  async pauseSession(sessionId: string) {
    console.log('⏸️ Pausing session:', sessionId);
    try {
      const browserInstance = this.activeSessions.get(sessionId);
      if (!browserInstance) {
        throw new Error(`Session ${sessionId} not found`);
      }

      const result = await browserInstance.pause();
      console.log('✅ Session paused:', result);
      return result;
    } catch (error) {
      console.error('❌ Failed to pause session:', error);
      throw error;
    }
  }

  async resumeSession(sessionId: string) {
    console.log('▶️ Resuming session:', sessionId);
    try {
      const browserInstance = this.activeSessions.get(sessionId);
      if (!browserInstance) {
        throw new Error(`Session ${sessionId} not found`);
      }

      const result = await browserInstance.resume();
      console.log('✅ Session resumed:', result);
      return result;
    } catch (error) {
      console.error('❌ Failed to resume session:', error);
      throw error;
    }
  }

  async saveAuthState(sessionId: string, name: string = 'default') {
    console.log('💾 Saving auth state for session:', sessionId, 'with name:', name);
    try {
      const browserInstance = this.activeSessions.get(sessionId);
      if (!browserInstance) {
        throw new Error(`Session ${sessionId} not found`);
      }

      const authState = await browserInstance.saveAuth({ name });
      console.log('✅ Auth state saved:', authState.authStateId);
      return authState;
    } catch (error) {
      console.error('❌ Failed to save auth state:', error);
      throw error;
    }
  }

  async destroySession(sessionId: string) {
    console.log('🗑️ Destroying session:', sessionId);
    try {
      const browserInstance = this.activeSessions.get(sessionId);
      if (!browserInstance) {
        console.log('⚠️ Session not found in cache, may already be stopped');
        return { status: 'not_found' };
      }

      // Call the SDK stop method
      const result = await browserInstance.stop();
      console.log('✅ Session stopped via SDK:', result);

      // Remove from our cache
      this.activeSessions.delete(sessionId);

      return { status: 'destroyed', ...result };
    } catch (error) {
      console.error('❌ Failed to destroy session:', error);
      throw error;
    }
  }

  // Get all active sessions
  getActiveSessions() {
    return Array.from(this.activeSessions.keys());
  }
}

export const scrapybaraClient = new ScrapybaraClient();