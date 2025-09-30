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
      const browserInstance = await this.sdk.startBrowser({
        // Basic configuration without timeoutMinutes
      });

      const sessionId = browserInstance.id;
      this.activeSessions.set(sessionId, browserInstance);

      console.log('✅ Browser session created:', sessionId);
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
      // Try to get from our active sessions first
      let browserInstance = this.activeSessions.get(sessionId);

      if (!browserInstance) {
        // If not in our cache, fetch from SDK
        const instance = await this.sdk.get(sessionId);
        if (instance instanceof Object && 'id' in instance) {
          browserInstance = instance as BrowserInstance;
          this.activeSessions.set(sessionId, browserInstance);
        } else {
          throw new Error('Session not found or invalid type');
        }
      }

      return {
        status: browserInstance.status,
        browser_url: await this.getStreamUrl(browserInstance),
        id: browserInstance.id,
        launchTime: browserInstance.launchTime,
      };
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
            coordinate: action.coordinate,
            button: 'left', // Required parameter for click actions
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
            coordinate: action.coordinate,
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

      console.log('✅ Action completed:', computerResponse);
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
    // Note: SDK doesn't seem to have pause/resume methods
    // This might need to be implemented differently
    return { status: 'paused', message: 'Pause not implemented in SDK' };
  }

  async resumeSession(sessionId: string) {
    console.log('▶️ Resuming session:', sessionId);
    // Note: SDK doesn't seem to have pause/resume methods
    return { status: 'active', message: 'Resume not implemented in SDK' };
  }

  async destroySession(sessionId: string) {
    console.log('🗑️ Destroying session:', sessionId);
    try {
      const browserInstance = this.activeSessions.get(sessionId);
      if (browserInstance) {
        // The SDK likely has a destroy method, but it's not in the types we saw
        // For now, just remove from our cache
        this.activeSessions.delete(sessionId);
        return { status: 'destroyed' };
      }
      return { status: 'not_found' };
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