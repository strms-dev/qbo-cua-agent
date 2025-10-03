-- Migration: Add anthropic_request and anthropic_response columns to messages table
-- Description: Store sanitized Anthropic API request/response data for audit trail
-- Created: 2025-01-10
-- Author: Gonzalo Alvarez de Toledo

-- Add two JSONB columns to store API request and response
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS anthropic_request JSONB,
  ADD COLUMN IF NOT EXISTS anthropic_response JSONB;

-- Add indexes for better query performance when filtering by API data
CREATE INDEX IF NOT EXISTS idx_messages_anthropic_request ON messages USING GIN (anthropic_request);
CREATE INDEX IF NOT EXISTS idx_messages_anthropic_response ON messages USING GIN (anthropic_response);

-- Add comment for documentation
COMMENT ON COLUMN messages.anthropic_request IS 'Sanitized Anthropic API request (base64 images stripped). Stored for assistant messages only.';
COMMENT ON COLUMN messages.anthropic_response IS 'Sanitized Anthropic API response (base64 images stripped). Stored for assistant messages only.';
