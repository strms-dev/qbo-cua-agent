/**
 * TypeScript type definitions for batch task execution API
 */

/**
 * Configuration overrides for agent execution
 * These override environment variables on a per-batch or per-task basis
 */
export interface ConfigOverrides {
  // Agent Loop Configuration
  AGENT_MAX_ITERATIONS?: number;         // Maximum iterations (default: 45)
  SAMPLING_LOOP_DELAY_MS?: number;       // Delay between iterations (default: 100)

  // Screenshot & Context Management
  MAX_BASE64_SCREENSHOTS?: number;       // Screenshots in context (default: 3)
  KEEP_RECENT_THINKING_BLOCKS?: number;  // Thinking blocks to keep (default: 50)

  // Anthropic API Configuration
  THINKING_BUDGET_TOKENS?: number;       // Thinking budget (default: 2048)
  ANTHROPIC_MAX_TOKENS?: number;         // Max response tokens (default: 4096)
  ANTHROPIC_MODEL?: string;              // Model name (default: claude-sonnet-4-20250514)

  // OnKernel/Playwright Configuration
  TYPING_DELAY_MS?: number;              // Typing delay (default: 0)
  ONKERNEL_TIMEOUT_SECONDS?: number;     // Browser timeout (default: 60)
}

/**
 * Configuration for a single task within a batch
 */
export interface TaskConfig {
  /** The message/instruction for the agent to execute */
  message: string;

  /** Whether to destroy the browser session after this task completes */
  destroyBrowserOnCompletion: boolean;

  /** Optional configuration overrides for this specific task */
  configOverrides?: ConfigOverrides;
}

/**
 * Request body for POST /api/tasks/execute
 */
export interface BatchExecutionRequest {
  /** Array of tasks to execute sequentially (1 or more) */
  tasks: TaskConfig[];

  /** Optional webhook URL to receive task status notifications */
  webhookUrl?: string;

  /** Optional secret for webhook HMAC signature verification */
  webhookSecret?: string;

  /** Optional global configuration overrides applied to all tasks */
  globalConfigOverrides?: ConfigOverrides;
}

/**
 * Response from POST /api/tasks/execute (returned immediately)
 */
export interface BatchExecutionResponse {
  /** Unique ID for this batch execution */
  batchExecutionId: string;

  /** Chat session ID */
  sessionId: string;

  /** Browser session ID (or 'pending' if not yet created) */
  browserSessionId: string;

  /** Array of task IDs (empty if tasks not yet created) */
  taskIds: string[];

  /** Current status of the batch */
  status: 'running';

  /** ISO 8601 timestamp of response */
  timestamp: string;
}

/**
 * Webhook payload sent when report_task_status tool is called
 */
export interface WebhookPayload {
  /** Type of webhook event */
  type: 'task_status';

  /** Batch execution ID this task belongs to */
  batchExecutionId: string;

  /** Individual task ID */
  taskId: string;

  /** Zero-based index of task in batch */
  taskIndex: number;

  /** Mapped task status in database */
  status: 'completed' | 'failed' | 'paused';

  /** Original agent status from report_task_status tool */
  agentStatus: 'completed' | 'failed' | 'needs_clarification';

  /** Agent's explanation message */
  message: string;

  /** Agent's reasoning (same as message for now) */
  reasoning?: string;

  /** Next step description (for paused tasks) */
  nextStep?: string;

  /** Optional evidence from agent */
  evidence?: {
    screenshot_url?: string;
    extracted_data?: any;
    error_details?: string;
    [key: string]: any;
  };

  /** ISO 8601 timestamp of status report */
  timestamp: string;
}

/**
 * Internal execution config passed to samplingLoopWithStreaming
 */
export interface ExecutionConfig {
  // Required execution parameters
  maxIterations: number;
  samplingDelay: number;
  maxBase64Screenshots: number;
  keepRecentThinkingBlocks: number;
  thinkingBudgetTokens: number;
  anthropicMaxTokens: number;
  anthropicModel: string;

  // Webhook configuration
  webhookUrl?: string;
  webhookSecret?: string;

  // Batch tracking
  batchExecutionId?: string;
  taskIndex?: number;
}

/**
 * Database record structure for batch_executions table
 */
export interface BatchExecutionRecord {
  id: string;
  session_id: string;
  browser_session_id: string | null;
  task_count: number;
  completed_count: number;
  failed_count: number;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  config_overrides: ConfigOverrides;
  webhook_url: string | null;
  webhook_secret: string | null;
  error_message: string | null;
  metadata: Record<string, any>;
}
