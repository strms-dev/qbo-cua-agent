-- Migration: Create batch_executions table
-- Description: Support batch execution of multiple tasks with shared browser session
-- Created: 2025-01-29

-- Create batch_executions table to track multi-task execution batches
CREATE TABLE batch_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  browser_session_id TEXT,

  -- Batch statistics
  task_count INTEGER NOT NULL CHECK (task_count > 0),
  completed_count INTEGER DEFAULT 0 CHECK (completed_count >= 0),
  failed_count INTEGER DEFAULT 0 CHECK (failed_count >= 0),

  -- Batch status: running, completed, failed, stopped
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'stopped')),

  -- Timing information
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Configuration and webhook
  config_overrides JSONB DEFAULT '{}',
  webhook_url TEXT,
  webhook_secret TEXT,

  -- Error tracking
  error_message TEXT,

  -- Additional metadata
  metadata JSONB DEFAULT '{}'
);

-- Indexes for efficient queries
CREATE INDEX idx_batch_executions_session ON batch_executions(session_id);
CREATE INDEX idx_batch_executions_status ON batch_executions(status);
CREATE INDEX idx_batch_executions_created_at ON batch_executions(created_at DESC);

-- Add comments for documentation
COMMENT ON TABLE batch_executions IS 'Tracks batch execution of multiple agent tasks with shared browser session';
COMMENT ON COLUMN batch_executions.config_overrides IS 'JSONB object containing environment variable overrides (e.g., AGENT_MAX_ITERATIONS, TYPING_DELAY_MS)';
COMMENT ON COLUMN batch_executions.webhook_url IS 'URL to POST webhook notifications when report_task_status tool is called';
COMMENT ON COLUMN batch_executions.webhook_secret IS 'Secret for HMAC signature verification of webhooks';
