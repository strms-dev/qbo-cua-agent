/**
 * BatchExecutor - Sequential task execution with shared browser session
 *
 * This class manages batch execution of multiple agent tasks:
 * - Creates ONE browser session shared across all tasks
 * - Executes tasks sequentially (task 0, then 1, then 2, etc.)
 * - Merges global + per-task configuration overrides
 * - Tracks batch progress in database (completed_count, failed_count)
 * - Only destroys browser if last task has destroyBrowserOnCompletion flag
 * - Sends webhook notifications when tasks report status
 */

import { supabase } from '@/lib/supabase';
import { OnkernelClient, onkernelClient } from '@/lib/onkernel';
import { samplingLoopWithStreaming, DEFAULT_SYSTEM_PROMPT } from '@/app/api/chat/route';
import {
  TaskConfig,
  ConfigOverrides,
  ExecutionConfig
} from '@/types/batch';

/**
 * Parameters for constructing a BatchExecutor
 */
export interface BatchExecutorParams {
  /** Unique ID for this batch execution */
  batchExecutionId: string;

  /** Chat session ID */
  sessionId: string;

  /** Array of task configurations to execute */
  tasks: TaskConfig[];

  /** Array of task IDs (created by API endpoint) */
  taskIds: string[];

  /** Global configuration overrides applied to all tasks */
  globalConfig: ConfigOverrides;

  /** Optional webhook URL for status notifications */
  webhookUrl?: string;

  /** Optional webhook secret for HMAC signatures */
  webhookSecret?: string;
}

/**
 * Default configuration values (reads from environment variables)
 */
const DEFAULT_CONFIG: ExecutionConfig = {
  agentMaxIterations: parseInt(process.env.AGENT_MAX_ITERATIONS || '35'),
  samplingLoopDelayMs: parseInt(process.env.SAMPLING_LOOP_DELAY_MS || '100'),
  maxBase64Screenshots: parseInt(process.env.MAX_BASE64_SCREENSHOTS || '3'),
  keepRecentThinkingBlocks: parseInt(process.env.KEEP_RECENT_THINKING_BLOCKS || '1'),
  thinkingBudgetTokens: parseInt(process.env.THINKING_BUDGET_TOKENS || '1024'),
  anthropicMaxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS || '4096'),
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
};

/**
 * BatchExecutor class - manages sequential task execution with shared browser
 */
export class BatchExecutor {
  private batchExecutionId: string;
  private sessionId: string;
  private tasks: TaskConfig[];
  private taskIds: string[];
  private globalConfig: ConfigOverrides;
  private webhookUrl?: string;
  private webhookSecret?: string;
  private browserSessionId: string | null = null;
  private onkernelClient: OnkernelClient;

  constructor(params: BatchExecutorParams) {
    this.batchExecutionId = params.batchExecutionId;
    this.sessionId = params.sessionId;
    this.tasks = params.tasks;
    this.taskIds = params.taskIds;
    this.globalConfig = params.globalConfig;
    this.webhookUrl = params.webhookUrl;
    this.webhookSecret = params.webhookSecret;
    this.onkernelClient = onkernelClient;
  }

  /**
   * Main execution method - called by API endpoint (fire and forget)
   * Executes all tasks sequentially and updates batch status
   */
  async execute(): Promise<void> {
    console.log(`🚀 BatchExecutor starting for batch: ${this.batchExecutionId}`);
    console.log(`📋 Total tasks: ${this.tasks.length}`);

    try {
      // Create browser session ONCE for all tasks
      this.browserSessionId = await this.createBrowserSession();
      console.log(`✅ Browser session created: ${this.browserSessionId}`);

      // Update batch with browser session ID
      await this.updateBatchBrowserSession(this.browserSessionId);

      // Execute tasks sequentially
      for (let i = 0; i < this.tasks.length; i++) {
        const task = this.tasks[i];
        const taskId = this.taskIds[i];
        const isLastTask = i === this.tasks.length - 1;

        console.log(`\n📝 Executing task ${i + 1}/${this.tasks.length} (ID: ${taskId})`);

        try {
          await this.executeTask(task, taskId, i);
          console.log(`✅ Task ${i + 1} completed successfully`);

          // Update completed count
          await this.incrementBatchCount('completed');

        } catch (error: any) {
          console.error(`❌ Task ${i + 1} failed:`, error.message);

          // Update failed count
          await this.incrementBatchCount('failed');

          // Mark task as failed in database
          await supabase
            .from('tasks')
            .update({
              status: 'failed',
              completed_at: new Date().toISOString(),
              result_message: `Task execution error: ${error.message}`
            })
            .eq('id', taskId);

          // Continue to next task (don't stop batch on task failure)
          console.log(`⏩ Continuing to next task despite failure`);
        }

        // Check if we should destroy browser after this task
        if (isLastTask && task.destroyBrowserOnCompletion && this.browserSessionId) {
          console.log(`🗑️ Destroying browser (last task with destroy flag)`);
          try {
            await this.onkernelClient.destroySession(this.browserSessionId);
            this.browserSessionId = null;
          } catch (error: any) {
            console.error(`⚠️ Failed to destroy browser:`, error.message);
          }
        }
      }

      // Mark batch as completed
      await this.updateBatchStatus('completed');
      console.log(`✅ Batch execution completed: ${this.batchExecutionId}`);

    } catch (error: any) {
      console.error(`❌ Batch execution failed:`, error);

      // Mark batch as failed
      await this.updateBatchStatus('failed', error.message);

      // Try to cleanup browser if it was created
      if (this.browserSessionId) {
        try {
          await this.onkernelClient.destroySession(this.browserSessionId);
        } catch (cleanupError: any) {
          console.error(`⚠️ Failed to cleanup browser after batch failure:`, cleanupError.message);
        }
      }
    }
  }

  /**
   * Execute a single task with merged configuration
   */
  private async executeTask(
    task: TaskConfig,
    taskId: string,
    taskIndex: number
  ): Promise<void> {
    if (!this.browserSessionId) {
      throw new Error('No browser session available');
    }

    // Merge global config + task-level config + batch metadata
    const mergedConfig = this.mergeConfigs(this.globalConfig, task.configOverrides, taskIndex);

    // Build system prompt and initial message
    const systemPrompt = this.buildSystemPrompt();

    // Build user message content with task_id tag
    const userMessageContent = `<task_id>${taskId}</task_id>\n\n${task.message}`;

    // Save user message to database (so it appears in UI)
    try {
      await supabase
        .from('messages')
        .insert({
          session_id: this.sessionId,
          role: 'user',
          content: task.message, // Store original message without task_id tag
          task_id: taskId
        });
      console.log(`✅ User message saved to database for task ${taskId}`);
    } catch (error: any) {
      console.error('⚠️ Failed to save user message:', error.message);
      // Continue execution even if save fails
    }

    const messages = [
      {
        role: 'user',
        content: userMessageContent // Use enhanced version with task_id for agent
      }
    ];

    // No-op stream callback (batch mode doesn't stream to UI)
    const streamCallback = (event: any) => {
      // Could log events for debugging if needed
      if (event.type === 'task_status') {
        console.log(`📊 Task status: ${event.status} - ${event.message}`);
      }
    };

    // Execute task using samplingLoopWithStreaming
    await samplingLoopWithStreaming(
      systemPrompt,
      messages,
      this.browserSessionId,
      this.sessionId,
      streamCallback,
      mergedConfig.agentMaxIterations,
      taskId,
      0, // startIteration
      mergedConfig // executionConfig
    );
  }

  /**
   * Merge global config + task config + batch metadata into ExecutionConfig
   */
  private mergeConfigs(
    global: ConfigOverrides,
    taskLevel: ConfigOverrides | undefined,
    taskIndex: number
  ): ExecutionConfig {
    // Task-level config takes precedence over global
    const merged: ConfigOverrides = {
      ...global,
      ...taskLevel
    };

    // Convert to ExecutionConfig with defaults
    return {
      agentMaxIterations: merged.AGENT_MAX_ITERATIONS ?? DEFAULT_CONFIG.agentMaxIterations,
      samplingLoopDelayMs: merged.SAMPLING_LOOP_DELAY_MS ?? DEFAULT_CONFIG.samplingLoopDelayMs,
      maxBase64Screenshots: merged.MAX_BASE64_SCREENSHOTS ?? DEFAULT_CONFIG.maxBase64Screenshots,
      keepRecentThinkingBlocks: merged.KEEP_RECENT_THINKING_BLOCKS ?? DEFAULT_CONFIG.keepRecentThinkingBlocks,
      thinkingBudgetTokens: merged.THINKING_BUDGET_TOKENS ?? DEFAULT_CONFIG.thinkingBudgetTokens,
      anthropicMaxTokens: merged.ANTHROPIC_MAX_TOKENS ?? DEFAULT_CONFIG.anthropicMaxTokens,
      anthropicModel: merged.ANTHROPIC_MODEL ?? DEFAULT_CONFIG.anthropicModel,
      typingDelayMs: merged.TYPING_DELAY_MS,
      onkernelTimeoutSeconds: merged.ONKERNEL_TIMEOUT_SECONDS,
      webhookUrl: this.webhookUrl,
      webhookSecret: this.webhookSecret,
      batchExecutionId: this.batchExecutionId,
      taskIndex: taskIndex,
    };
  }

  /**
   * Create browser session for the batch
   */
  private async createBrowserSession(): Promise<string> {
    const session = await this.onkernelClient.createSession();
    return session.sessionId;
  }

  /**
   * Update batch_executions with browser session ID
   */
  private async updateBatchBrowserSession(browserSessionId: string): Promise<void> {
    await supabase
      .from('batch_executions')
      .update({ browser_session_id: browserSessionId })
      .eq('id', this.batchExecutionId);
  }

  /**
   * Update batch status
   */
  private async updateBatchStatus(
    status: 'running' | 'completed' | 'failed' | 'stopped',
    errorMessage?: string
  ): Promise<void> {
    const updates: any = {
      status,
      completed_at: status === 'completed' || status === 'failed' ? new Date().toISOString() : null,
    };

    if (errorMessage) {
      updates.error_message = errorMessage;
    }

    await supabase
      .from('batch_executions')
      .update(updates)
      .eq('id', this.batchExecutionId);
  }

  /**
   * Increment completed_count or failed_count
   */
  private async incrementBatchCount(type: 'completed' | 'failed'): Promise<void> {
    // Get current counts
    const { data: batch } = await supabase
      .from('batch_executions')
      .select('completed_count, failed_count')
      .eq('id', this.batchExecutionId)
      .single();

    if (batch) {
      const updates: any = {};
      if (type === 'completed') {
        updates.completed_count = (batch.completed_count || 0) + 1;
      } else {
        updates.failed_count = (batch.failed_count || 0) + 1;
      }

      await supabase
        .from('batch_executions')
        .update(updates)
        .eq('id', this.batchExecutionId);
    }
  }

  /**
   * Build system prompt for agent (uses DEFAULT_SYSTEM_PROMPT from route.ts)
   */
  private buildSystemPrompt(): string {
    return DEFAULT_SYSTEM_PROMPT;
  }
}
