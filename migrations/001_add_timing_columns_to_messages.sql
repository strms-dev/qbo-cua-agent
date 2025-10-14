-- Migration: Add timing columns to messages table
-- Description: Adds anthropic_response_time_ms column to track API response time per request
-- Date: 2025-10-10

-- Add anthropic_response_time_ms column to messages table
ALTER TABLE messages
ADD COLUMN anthropic_response_time_ms BIGINT;

-- Add comment for documentation
COMMENT ON COLUMN messages.anthropic_response_time_ms IS 'Time in milliseconds for Anthropic API to respond to this request';

-- Optional: Create index for performance queries
CREATE INDEX idx_messages_response_time ON messages(anthropic_response_time_ms)
WHERE anthropic_response_time_ms IS NOT NULL;
