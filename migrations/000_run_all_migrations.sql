-- Master Migration Script: Performance Tracking & Task Management
-- Description: Runs all migrations in order
-- Date: 2025-01-14
--
-- INSTRUCTIONS:
-- 1. Connect to your Supabase database (via SQL Editor in Supabase Dashboard)
-- 2. Run this entire script, OR run each migration individually in order:
--    - 001_add_timing_columns_to_messages.sql
--    - 002_add_timing_columns_to_chat_sessions.sql
--    - 003_create_performance_metrics_table.sql
--    - 004_create_tasks_table.sql

-- =============================================================================
-- Migration 001: Add timing columns to messages table
-- =============================================================================

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS anthropic_response_time_ms BIGINT;

COMMENT ON COLUMN messages.anthropic_response_time_ms IS 'Time in milliseconds for Anthropic API to respond to this request';

CREATE INDEX IF NOT EXISTS idx_messages_response_time ON messages(anthropic_response_time_ms)
WHERE anthropic_response_time_ms IS NOT NULL;

-- =============================================================================
-- Migration 002: Add timing columns to chat_sessions table
-- =============================================================================

ALTER TABLE chat_sessions
ADD COLUMN IF NOT EXISTS total_conversation_time_ms BIGINT,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS total_iterations INTEGER;

COMMENT ON COLUMN chat_sessions.total_conversation_time_ms IS 'Total time from first API call to conversation completion in milliseconds';
COMMENT ON COLUMN chat_sessions.completed_at IS 'Timestamp when conversation completed (no more tool calls needed)';
COMMENT ON COLUMN chat_sessions.total_iterations IS 'Number of sampling loop iterations until completion';

CREATE INDEX IF NOT EXISTS idx_chat_sessions_conversation_time ON chat_sessions(total_conversation_time_ms)
WHERE total_conversation_time_ms IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_completed_at ON chat_sessions(completed_at)
WHERE completed_at IS NOT NULL;

-- =============================================================================
-- Migration 003: Create performance_metrics table
-- =============================================================================

CREATE TABLE IF NOT EXISTS performance_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  iteration INTEGER NOT NULL,

  -- Timing metrics (all in milliseconds)
  api_response_time_ms BIGINT,        -- Time for Anthropic API to respond (from request to response)
  iteration_total_time_ms BIGINT,     -- Total time for entire iteration (API + tool execution + overhead)
  tool_execution_time_ms BIGINT,      -- Time spent executing all tools in this iteration

  -- Additional context
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE performance_metrics IS 'Detailed performance tracking for each iteration of the agent sampling loop';
COMMENT ON COLUMN performance_metrics.session_id IS 'Reference to the chat session';
COMMENT ON COLUMN performance_metrics.message_id IS 'Reference to the assistant message created in this iteration';
COMMENT ON COLUMN performance_metrics.iteration IS 'Iteration number (1-based) in the sampling loop';
COMMENT ON COLUMN performance_metrics.api_response_time_ms IS 'Time in milliseconds for Anthropic API to respond (thinking + generation)';
COMMENT ON COLUMN performance_metrics.iteration_total_time_ms IS 'Total time in milliseconds for entire iteration (API + tools + overhead)';
COMMENT ON COLUMN performance_metrics.tool_execution_time_ms IS 'Time in milliseconds spent executing computer tool actions';
COMMENT ON COLUMN performance_metrics.metadata IS 'Additional context (screenshots count, tools executed, etc.)';

CREATE INDEX IF NOT EXISTS idx_performance_metrics_session_id ON performance_metrics(session_id);
CREATE INDEX IF NOT EXISTS idx_performance_metrics_message_id ON performance_metrics(message_id)
WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_performance_metrics_session_iteration ON performance_metrics(session_id, iteration);
CREATE INDEX IF NOT EXISTS idx_performance_metrics_api_response_time ON performance_metrics(api_response_time_ms)
WHERE api_response_time_ms IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_performance_metrics_created_at ON performance_metrics(created_at DESC);

-- =============================================================================
-- Migration 004: Create tasks table
-- =============================================================================

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  browser_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'stopped', 'paused', 'completed', 'failed')),
  user_message TEXT NOT NULL,
  result_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  max_iterations INTEGER DEFAULT 35,
  current_iteration INTEGER DEFAULT 0,
  agent_status TEXT CHECK (agent_status IN ('completed', 'failed', 'needs_clarification')),
  agent_message TEXT,
  agent_evidence JSONB,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'
);

COMMENT ON TABLE tasks IS 'Tracks individual agent tasks within chat sessions. Each task represents a user request being processed by the agent.';
COMMENT ON COLUMN tasks.status IS 'Current task status: queued (waiting), running (active), stopped (user halted), paused (needs clarification), completed (success), failed (error)';
COMMENT ON COLUMN tasks.agent_status IS 'Agent self-reported status via report_task_status tool';
COMMENT ON COLUMN tasks.current_iteration IS 'Current iteration number - used for resuming stopped/paused tasks';

CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_browser_session ON tasks(browser_session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_session_status ON tasks(session_id, status)
  WHERE status IN ('running', 'paused', 'stopped');

ALTER TABLE messages ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_task_id ON messages(task_id);
COMMENT ON COLUMN messages.task_id IS 'Reference to the task this message belongs to';

ALTER TABLE performance_metrics ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_performance_metrics_task_id ON performance_metrics(task_id);
COMMENT ON COLUMN performance_metrics.task_id IS 'Reference to the task these metrics belong to';

ALTER TABLE computer_actions ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_computer_actions_task_id ON computer_actions(task_id);
COMMENT ON COLUMN computer_actions.task_id IS 'Reference to the task this action belongs to';

CREATE OR REPLACE FUNCTION get_active_task(p_session_id UUID)
RETURNS UUID AS $$
BEGIN
  RETURN (
    SELECT id FROM tasks
    WHERE session_id = p_session_id AND status = 'running'
    ORDER BY created_at DESC LIMIT 1
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_resumable_task(p_session_id UUID)
RETURNS UUID AS $$
BEGIN
  RETURN (
    SELECT id FROM tasks
    WHERE session_id = p_session_id AND status IN ('stopped', 'paused')
    ORDER BY created_at DESC LIMIT 1
  );
END;
$$ LANGUAGE plpgsql;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS tasks_policy ON tasks FOR ALL USING (true) WITH CHECK (true);

-- =============================================================================
-- Migration Complete
-- =============================================================================

-- Verify migrations
DO $$
BEGIN
  RAISE NOTICE 'Migration complete! Verifying...';

  -- Check messages table
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages'
    AND column_name = 'anthropic_response_time_ms'
  ) THEN
    RAISE NOTICE '✓ messages.anthropic_response_time_ms column exists';
  ELSE
    RAISE EXCEPTION '✗ messages.anthropic_response_time_ms column missing';
  END IF;

  -- Check chat_sessions table
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'chat_sessions'
    AND column_name = 'total_conversation_time_ms'
  ) THEN
    RAISE NOTICE '✓ chat_sessions.total_conversation_time_ms column exists';
  ELSE
    RAISE EXCEPTION '✗ chat_sessions.total_conversation_time_ms column missing';
  END IF;

  -- Check performance_metrics table
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'performance_metrics'
  ) THEN
    RAISE NOTICE '✓ performance_metrics table exists';
  ELSE
    RAISE EXCEPTION '✗ performance_metrics table missing';
  END IF;

  -- Check tasks table
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'tasks'
  ) THEN
    RAISE NOTICE '✓ tasks table exists';
  ELSE
    RAISE EXCEPTION '✗ tasks table missing';
  END IF;

  -- Check task_id columns
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'task_id'
  ) THEN
    RAISE NOTICE '✓ messages.task_id column exists';
  ELSE
    RAISE EXCEPTION '✗ messages.task_id column missing';
  END IF;

  RAISE NOTICE '✅ All migrations applied successfully!';
END $$;
