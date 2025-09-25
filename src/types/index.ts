export interface ChatSession {
  id: string;
  created_at: string;
  browser_session_id?: string;
  status: 'active' | 'paused' | 'completed' | 'error';
}

export interface Message {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  created_at: string;
}

export interface ToolCall {
  id: string;
  type: 'computer_use' | 'screenshot' | 'approval_request';
  parameters: Record<string, any>;
  result?: any;
  status: 'pending' | 'completed' | 'failed' | 'awaiting_approval';
}

export interface ComputerAction {
  id: string;
  session_id: string;
  action_type: 'click' | 'type' | 'scroll' | 'screenshot';
  coordinates?: { x: number; y: number };
  text?: string;
  screenshot_url?: string;
  risk_level: 'low' | 'medium' | 'high';
  requires_approval: boolean;
  approval_status?: 'pending' | 'approved' | 'denied';
  created_at: string;
}

export interface ApprovalRequest {
  id: string;
  session_id: string;
  action_id: string;
  form_id: string;
  status: 'pending' | 'approved' | 'denied';
  screenshot_url: string;
  risk_assessment: string;
  created_at: string;
  resolved_at?: string;
}

export interface ScrapybaraSession {
  session_id: string;
  status: 'active' | 'paused' | 'stopped';
  browser_url?: string;
  created_at: string;
}