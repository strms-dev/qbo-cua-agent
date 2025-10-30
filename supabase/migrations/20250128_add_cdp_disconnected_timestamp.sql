-- Migration: Add cdp_disconnected_at timestamp column
-- Description: Track when CDP was disconnected for audit trail and debugging
-- Created: 2025-01-28

-- Add timestamp column to track CDP disconnection time
ALTER TABLE browser_sessions
  ADD COLUMN IF NOT EXISTS cdp_disconnected_at TIMESTAMP WITH TIME ZONE;

-- Add comment for documentation
COMMENT ON COLUMN browser_sessions.cdp_disconnected_at IS 'Timestamp when CDP connection was last disconnected. Used for audit trail and debugging connection lifecycle.';
