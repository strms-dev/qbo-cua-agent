export class GoToHumanClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.GOTOHUMAN_BASE_URL || 'https://api.gotohuman.com';
    this.apiKey = process.env.GOTOHUMAN_API_KEY!;
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
      throw new Error(`GoToHuman API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async createApprovalRequest(params: {
    formId: string;
    fields: Record<string, any>;
    meta?: Record<string, any>;
    assignTo?: string[];
  }) {
    return this.request('/reviews', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async getApprovalStatus(reviewId: string) {
    return this.request(`/reviews/${reviewId}`);
  }

  async createHighRiskActionForm() {
    // This would typically be done once through the GoToHuman dashboard
    // But we can create it programmatically if needed
    return this.request('/forms', {
      method: 'POST',
      body: JSON.stringify({
        name: 'High Risk QBO Action Approval',
        description: 'Requires human approval for potentially risky actions in QuickBooks Online',
        fields: [
          {
            name: 'action_description',
            type: 'text',
            label: 'Action Description',
            required: true,
          },
          {
            name: 'screenshot',
            type: 'image',
            label: 'Screenshot',
            required: true,
          },
          {
            name: 'risk_assessment',
            type: 'textarea',
            label: 'AI Risk Assessment',
            required: true,
          },
          {
            name: 'approval_decision',
            type: 'select',
            label: 'Decision',
            options: ['approve', 'deny'],
            required: true,
          },
        ],
      }),
    });
  }
}

export const goToHumanClient = new GoToHumanClient();