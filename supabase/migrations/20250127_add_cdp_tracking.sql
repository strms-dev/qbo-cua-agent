-- Migration: Add CDP connection tracking to browser_sessions
-- Description: Track CDP connection state and store CDP URL for reconnection
-- Created: 2025-01-27
-- Author: Gonzalo Alvarez de Toledo

-- Add CDP tracking columns to browser_sessions table
ALTER TABLE browser_sessions
  ADD COLUMN IF NOT EXISTS cdp_connected BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS cdp_ws_url TEXT,
  ADD COLUMN IF NOT EXISTS live_view_url TEXT;

-- Add index for filtering by CDP connection status
CREATE INDEX IF NOT EXISTS idx_browser_sessions_cdp_connected
  ON browser_sessions(cdp_connected);

-- Add comments for documentation
COMMENT ON COLUMN browser_sessions.cdp_connected IS 'Indicates whether CDP (Chrome DevTools Protocol) is currently connected to this browser session. Disconnecting CDP stops OnKernel billing while keeping browser alive.';
COMMENT ON COLUMN browser_sessions.cdp_ws_url IS 'CDP WebSocket URL for reconnecting to the browser session. URL is permanent for the lifetime of the browser.';
COMMENT ON COLUMN browser_sessions.live_view_url IS 'OnKernel live view URL for streaming browser display to frontend.';

-- Migration complete
DO $$
BEGIN
  RAISE NOTICE 'Migration 20250127_add_cdp_tracking completed successfully';
  RAISE NOTICE 'Added cdp_connected, cdp_ws_url, live_view_url columns to browser_sessions';
  RAISE NOTICE 'Created index on cdp_connected for performance';
END $$;
