-- Migration: Add timing columns to chat_sessions table
-- Description: Adds conversation-level timing metrics
-- Date: 2025-10-10

-- Add timing and completion columns to chat_sessions table
ALTER TABLE chat_sessions
ADD COLUMN total_conversation_time_ms BIGINT,
ADD COLUMN completed_at TIMESTAMPTZ,
ADD COLUMN total_iterations INTEGER;

-- Add comments for documentation
COMMENT ON COLUMN chat_sessions.total_conversation_time_ms IS 'Total time from first API call to conversation completion in milliseconds';
COMMENT ON COLUMN chat_sessions.completed_at IS 'Timestamp when conversation completed (no more tool calls needed)';
COMMENT ON COLUMN chat_sessions.total_iterations IS 'Number of sampling loop iterations until completion';

-- Create index for querying completed sessions by duration
CREATE INDEX idx_chat_sessions_conversation_time ON chat_sessions(total_conversation_time_ms)
WHERE total_conversation_time_ms IS NOT NULL;

-- Create index for querying completed sessions
CREATE INDEX idx_chat_sessions_completed_at ON chat_sessions(completed_at)
WHERE completed_at IS NOT NULL;
