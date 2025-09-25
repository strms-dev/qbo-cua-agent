export class ScrapybaraClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.SCRAPYBARA_BASE_URL || 'https://api.scrapybara.com';
    this.apiKey = process.env.SCRAPYBARA_API_KEY!;
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Scrapybara API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async createSession() {
    return this.request('/sessions', {
      method: 'POST',
      body: JSON.stringify({
        instance_type: 'browser',
        timeout: 3600, // 1 hour timeout
      }),
    });
  }

  async getSession(sessionId: string) {
    return this.request(`/sessions/${sessionId}`);
  }

  async pauseSession(sessionId: string) {
    return this.request(`/sessions/${sessionId}/pause`, {
      method: 'POST',
    });
  }

  async resumeSession(sessionId: string) {
    return this.request(`/sessions/${sessionId}/resume`, {
      method: 'POST',
    });
  }

  async destroySession(sessionId: string) {
    return this.request(`/sessions/${sessionId}`, {
      method: 'DELETE',
    });
  }

  async takeScreenshot(sessionId: string) {
    return this.request(`/sessions/${sessionId}/screenshot`, {
      method: 'POST',
    });
  }

  async performAction(sessionId: string, action: {
    action: string;
    coordinate?: [number, number];
    text?: string;
    [key: string]: any;
  }) {
    return this.request(`/sessions/${sessionId}/action`, {
      method: 'POST',
      body: JSON.stringify(action),
    });
  }
}

export const scrapybaraClient = new ScrapybaraClient();