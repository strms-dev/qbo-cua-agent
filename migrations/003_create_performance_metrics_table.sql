-- Migration: Create performance_metrics table
-- Description: Creates a dedicated table for detailed performance tracking per iteration
-- Date: 2025-10-10

-- Create performance_metrics table
CREATE TABLE performance_metrics (
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

-- Add comments for documentation
COMMENT ON TABLE performance_metrics IS 'Detailed performance tracking for each iteration of the agent sampling loop';
COMMENT ON COLUMN performance_metrics.session_id IS 'Reference to the chat session';
COMMENT ON COLUMN performance_metrics.message_id IS 'Reference to the assistant message created in this iteration';
COMMENT ON COLUMN performance_metrics.iteration IS 'Iteration number (1-based) in the sampling loop';
COMMENT ON COLUMN performance_metrics.api_response_time_ms IS 'Time in milliseconds for Anthropic API to respond (thinking + generation)';
COMMENT ON COLUMN performance_metrics.iteration_total_time_ms IS 'Total time in milliseconds for entire iteration (API + tools + overhead)';
COMMENT ON COLUMN performance_metrics.tool_execution_time_ms IS 'Time in milliseconds spent executing computer tool actions';
COMMENT ON COLUMN performance_metrics.metadata IS 'Additional context (screenshots count, tools executed, etc.)';

-- Create indexes for common query patterns
CREATE INDEX idx_performance_metrics_session_id ON performance_metrics(session_id);
CREATE INDEX idx_performance_metrics_message_id ON performance_metrics(message_id)
WHERE message_id IS NOT NULL;
CREATE INDEX idx_performance_metrics_session_iteration ON performance_metrics(session_id, iteration);
CREATE INDEX idx_performance_metrics_api_response_time ON performance_metrics(api_response_time_ms)
WHERE api_response_time_ms IS NOT NULL;
CREATE INDEX idx_performance_metrics_created_at ON performance_metrics(created_at DESC);

-- Enable Row Level Security (RLS) if needed - adjust policies based on your requirements
-- ALTER TABLE performance_metrics ENABLE ROW LEVEL SECURITY;
