-- Migration: Simplify memory_files table to task-id based structure
-- Description: Remove company_id and task_type columns, use task_id as file_path
-- Author: Gonzalo Alvarez de Toledo
-- Date: 2025-01-21

-- ============================================================================
-- 1. REMOVE COMPANY-BASED COLUMNS
-- ============================================================================

-- Drop company and task type columns from memory_files
ALTER TABLE memory_files DROP COLUMN IF EXISTS company_id CASCADE;
ALTER TABLE memory_files DROP COLUMN IF EXISTS task_type CASCADE;

-- ============================================================================
-- 2. DROP OLD INDEXES
-- ============================================================================

-- Remove company-based indexes (no longer needed)
DROP INDEX IF EXISTS idx_memory_files_company;
DROP INDEX IF EXISTS idx_memory_files_company_task;

-- Keep file_path index (still useful for lookups by task_id)
-- idx_memory_files_path already exists, no action needed

-- ============================================================================
-- 3. UPDATE TABLE COMMENTS
-- ============================================================================

-- Update comments to reflect new task-id based structure
COMMENT ON TABLE memory_files IS 'Backend storage for Anthropic memory tool - one memory file per task_id (file_path = task_id)';
COMMENT ON COLUMN memory_files.file_path IS 'Task ID used as memory file path (e.g., "abc-123-def-456" or "/memories/abc-123-def-456" stored without prefix)';
COMMENT ON COLUMN memory_files.content IS 'Memory content as text/JSON - contains task progress, decisions, and context for resumption';

-- ============================================================================
-- 4. CLEAN UP EXISTING DATA (if any)
-- ============================================================================

-- Delete any existing memory files from old company-based structure
-- This is safe since the old structure is incompatible with new task-id approach
DELETE FROM memory_files;

COMMENT ON COLUMN memory_files.created_at IS 'When memory file was first created (task started)';
COMMENT ON COLUMN memory_files.updated_at IS 'Last update timestamp (last memory save)';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration 20250121 completed successfully';
  RAISE NOTICE 'Removed company_id and task_type columns from memory_files';
  RAISE NOTICE 'Updated table structure to task-id based: file_path = task_id';
  RAISE NOTICE 'Cleaned up old company-based memory files';
  RAISE NOTICE 'New memory file naming: /memories/{task_id}';
END $$;
