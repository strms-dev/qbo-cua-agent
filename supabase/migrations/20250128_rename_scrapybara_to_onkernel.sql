-- Migration: Rename scrapybara_session_id to onkernel_session_id
-- Description: Fix column name mismatch causing silent database update failures
-- Created: 2025-01-28
-- Author: Gonzalo Alvarez de Toledo

-- Rename column to match OnKernel terminology used throughout the codebase
ALTER TABLE browser_sessions
  RENAME COLUMN scrapybara_session_id TO onkernel_session_id;

-- Update index/constraint names for consistency
ALTER INDEX IF EXISTS browser_sessions_scrapybara_session_id_key
  RENAME TO browser_sessions_onkernel_session_id_key;

-- Add comment for documentation
COMMENT ON COLUMN browser_sessions.onkernel_session_id IS 'OnKernel browser session ID (formerly scrapybara_session_id). Used to track remote browser sessions.';
