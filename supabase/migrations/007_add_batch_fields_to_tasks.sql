-- Migration: Add batch execution fields to tasks table
-- Description: Extend tasks table to support batch execution tracking
-- Created: 2025-01-29

-- Add batch execution tracking fields
ALTER TABLE tasks ADD COLUMN batch_execution_id UUID REFERENCES batch_executions(id) ON DELETE CASCADE;
ALTER TABLE tasks ADD COLUMN task_index INTEGER CHECK (task_index >= 0);
ALTER TABLE tasks ADD COLUMN destroy_browser_on_completion BOOLEAN DEFAULT false NOT NULL;

-- Create indexes for efficient batch queries
CREATE INDEX idx_tasks_batch_execution ON tasks(batch_execution_id);
CREATE INDEX idx_tasks_batch_index ON tasks(batch_execution_id, task_index);

-- Add comments for documentation
COMMENT ON COLUMN tasks.batch_execution_id IS 'Reference to parent batch_executions record if task is part of a batch';
COMMENT ON COLUMN tasks.task_index IS 'Zero-based index of task within batch (0 = first task, 1 = second, etc.)';
COMMENT ON COLUMN tasks.destroy_browser_on_completion IS 'Whether to destroy browser session when this task completes (typically true for last task in batch)';
