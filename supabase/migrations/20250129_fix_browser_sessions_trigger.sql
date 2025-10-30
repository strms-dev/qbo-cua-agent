-- Migration: Remove broken trigger from browser_sessions
-- Description: This trigger incorrectly tries to set updated_at column which doesn't exist
-- Created: 2025-01-29
-- Author: Gonzalo Alvarez de Toledo

-- The browser_sessions table is designed to use manual last_activity_at tracking
-- (only specific browser activity events should update the timestamp).
-- Other tables (chat_sessions, companies, memory_files) use automatic updated_at triggers.

-- Drop the broken trigger that causes error: "record 'new' has no field 'updated_at'"
DROP TRIGGER IF EXISTS update_browser_sessions_last_activity ON browser_sessions;

-- Migration complete
DO $$
BEGIN
  RAISE NOTICE 'Migration 20250129_fix_browser_sessions_trigger completed successfully';
  RAISE NOTICE 'Removed broken trigger that referenced non-existent updated_at column';
  RAISE NOTICE 'browser_sessions will continue using manual last_activity_at tracking';
END $$;
