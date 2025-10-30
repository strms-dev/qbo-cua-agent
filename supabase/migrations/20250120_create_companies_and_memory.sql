-- Migration: Create companies and memory_files tables for Anthropic memory tool
-- Description: Adds company tracking and memory tool backend storage
-- Author: Gonzalo Alvarez de Toledo
-- Date: 2025-01-20

-- ============================================================================
-- 1. CREATE COMPANIES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,  -- e.g., "acme_inc", "tenzo_corp"
  preferences JSONB DEFAULT '{}',  -- Company-specific preferences (accounting rules, etc.)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Comments for documentation
COMMENT ON TABLE companies IS 'Companies for which the AI agent performs bookkeeping tasks';
COMMENT ON COLUMN companies.slug IS 'URL-safe unique identifier (e.g., acme_inc)';
COMMENT ON COLUMN companies.preferences IS 'Company-specific preferences and settings';

-- ============================================================================
-- 2. ADD COMPANY FIELDS TO TASKS TABLE
-- ============================================================================

-- Add company_id to link tasks to companies
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

-- Add task_type to categorize tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_type TEXT;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tasks_company_id ON tasks(company_id);
CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_tasks_company_task ON tasks(company_id, task_type);

-- Add comments
COMMENT ON COLUMN tasks.company_id IS 'Reference to the company this task is for';
COMMENT ON COLUMN tasks.task_type IS 'Type of task (e.g., bank_statement_download, qbo_triage)';

-- ============================================================================
-- 3. CREATE MEMORY_FILES TABLE (Backend for Anthropic Memory Tool)
-- ============================================================================

CREATE TABLE IF NOT EXISTS memory_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path TEXT NOT NULL UNIQUE,  -- Virtual path: companies/{slug}/{task_type}_memory.json
  content TEXT NOT NULL,           -- JSON string (Claude's memory format)
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  task_type TEXT,                  -- For filtering and organization
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_memory_files_company ON memory_files(company_id);
CREATE INDEX IF NOT EXISTS idx_memory_files_path ON memory_files(file_path);
CREATE INDEX IF NOT EXISTS idx_memory_files_company_task ON memory_files(company_id, task_type);

-- Comments for documentation
COMMENT ON TABLE memory_files IS 'Backend storage for Anthropic memory tool - stores persistent context across agent sessions';
COMMENT ON COLUMN memory_files.file_path IS 'Virtual file path used by Claude memory tool (e.g., companies/acme_inc/bank_download_memory.json)';
COMMENT ON COLUMN memory_files.content IS 'Memory content as text/JSON - contains learned patterns, decisions, and context';
COMMENT ON COLUMN memory_files.company_id IS 'Link to company (for filtering and cascade deletion)';
COMMENT ON COLUMN memory_files.task_type IS 'Task type this memory is for (e.g., bank_statement_download)';

-- ============================================================================
-- 4. ENABLE ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_files ENABLE ROW LEVEL SECURITY;

-- Policies: Allow all operations for now (can be restricted later)
CREATE POLICY companies_policy ON companies
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY memory_files_policy ON memory_files
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 5. CREATE UPDATE TRIGGERS
-- ============================================================================

-- Trigger for companies updated_at
CREATE TRIGGER update_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for memory_files updated_at
CREATE TRIGGER update_memory_files_updated_at
  BEFORE UPDATE ON memory_files
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 6. SEED EXAMPLE COMPANIES
-- ============================================================================

-- Insert example companies (will be used in tests)
INSERT INTO companies (name, slug, preferences) VALUES
  ('Acme Inc', 'acme_inc', '{"accounting_method": "accrual"}'),
  ('Tenzo Corp', 'tenzo_corp', '{"accounting_method": "cash"}')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration 20250120 completed successfully';
  RAISE NOTICE 'Created companies table with 2 example companies';
  RAISE NOTICE 'Created memory_files table for Anthropic memory tool backend';
  RAISE NOTICE 'Added company_id and task_type columns to tasks table';
  RAISE NOTICE 'Memory file structure: companies/{slug}/{task_type}_memory.json';
END $$;
