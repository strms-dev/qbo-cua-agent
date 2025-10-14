-- Migration: Create tasks table and add task_id to related tables
-- Description: Implements task-based architecture for agent execution tracking
-- Author: Gonzalo Alvarez de Toledo
-- Date: 2025-01-14

-- ============================================================================
-- 1. CREATE TASKS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  browser_session_id TEXT, -- Reference to OnKernel session ID

  -- Task Status Lifecycle
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'stopped', 'paused', 'completed', 'failed')),

  -- Task Content
  user_message TEXT NOT NULL, -- User's initial request that started this task
  result_message TEXT, -- Agent's final response when completed

  -- Timing
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ, -- When status changed to 'running'
  completed_at TIMESTAMPTZ, -- When status changed to 'completed'/'failed'/'stopped'

  -- Execution Metrics
  max_iterations INTEGER DEFAULT 35, -- Maximum iterations allowed for this task
  current_iteration INTEGER DEFAULT 0, -- Current iteration number (for resume)

  -- Agent Self-Reporting (from report_task_status tool)
  agent_status TEXT CHECK (agent_status IN ('completed', 'failed', 'needs_clarification')),
  agent_message TEXT, -- Agent's explanation of completion/failure/pause
  agent_evidence JSONB, -- Supporting evidence (screenshots, data, errors)

  -- Error Tracking
  error_message TEXT, -- System error message if task failed unexpectedly

  -- Additional Context
  metadata JSONB DEFAULT '{}'
);

-- Add comments for documentation
COMMENT ON TABLE tasks IS 'Tracks individual agent tasks within chat sessions. Each task represents a user request being processed by the agent.';
COMMENT ON COLUMN tasks.status IS 'Current task status: queued (waiting), running (active), stopped (user halted), paused (needs clarification), completed (success), failed (error)';
COMMENT ON COLUMN tasks.agent_status IS 'Agent self-reported status via report_task_status tool';
COMMENT ON COLUMN tasks.agent_message IS 'Agent explanation when reporting task status';
COMMENT ON COLUMN tasks.agent_evidence IS 'Evidence provided by agent (screenshots, extracted data, etc.)';
COMMENT ON COLUMN tasks.current_iteration IS 'Current iteration number - used for resuming stopped/paused tasks';
COMMENT ON COLUMN tasks.max_iterations IS 'Maximum iterations allowed for this task (from env config)';

-- ============================================================================
-- 2. CREATE INDEXES FOR PERFORMANCE
-- ============================================================================

CREATE INDEX idx_tasks_session_id ON tasks(session_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_browser_session ON tasks(browser_session_id);
CREATE INDEX idx_tasks_created_at ON tasks(created_at DESC);

-- Composite index for finding active/paused tasks in a session
CREATE INDEX idx_tasks_session_status ON tasks(session_id, status)
  WHERE status IN ('running', 'paused', 'stopped');

-- ============================================================================
-- 3. ADD task_id TO EXISTING TABLES
-- ============================================================================

-- Add task_id to messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_task_id ON messages(task_id);
COMMENT ON COLUMN messages.task_id IS 'Reference to the task this message belongs to';

-- Add task_id to performance_metrics table
ALTER TABLE performance_metrics ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_performance_metrics_task_id ON performance_metrics(task_id);
COMMENT ON COLUMN performance_metrics.task_id IS 'Reference to the task these metrics belong to';

-- Add task_id to computer_actions table
ALTER TABLE computer_actions ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_computer_actions_task_id ON computer_actions(task_id);
COMMENT ON COLUMN computer_actions.task_id IS 'Reference to the task this action belongs to';

-- ============================================================================
-- 4. CREATE HELPER FUNCTIONS (Optional but useful)
-- ============================================================================

-- Function to get the current active task for a session
CREATE OR REPLACE FUNCTION get_active_task(p_session_id UUID)
RETURNS UUID AS $$
BEGIN
  RETURN (
    SELECT id
    FROM tasks
    WHERE session_id = p_session_id
      AND status = 'running'
    ORDER BY created_at DESC
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql;

-- Function to get resumable task for a session (stopped or paused)
CREATE OR REPLACE FUNCTION get_resumable_task(p_session_id UUID)
RETURNS UUID AS $$
BEGIN
  RETURN (
    SELECT id
    FROM tasks
    WHERE session_id = p_session_id
      AND status IN ('stopped', 'paused')
    ORDER BY created_at DESC
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. ENABLE ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations for now (can be restricted later)
CREATE POLICY tasks_policy ON tasks
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Verify migration
DO $$
BEGIN
  RAISE NOTICE 'Migration 004 completed successfully';
  RAISE NOTICE 'Created tasks table with indexes';
  RAISE NOTICE 'Added task_id columns to messages, performance_metrics, computer_actions';
  RAISE NOTICE 'Created helper functions: get_active_task, get_resumable_task';
END $$;
