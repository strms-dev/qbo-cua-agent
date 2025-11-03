-- Add config_overrides column to tasks table for batch API configuration
-- This allows per-task configuration overrides (AGENT_MAX_ITERATIONS, ANTHROPIC_MAX_TOKENS, etc.)

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS config_overrides JSONB DEFAULT '{}'::jsonb NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN tasks.config_overrides IS 'Per-task configuration overrides for batch API execution (e.g., AGENT_MAX_ITERATIONS, ANTHROPIC_MAX_TOKENS)';
