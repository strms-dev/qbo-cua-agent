-- Create downloaded_files table for tracking files downloaded during browser sessions
-- This enables cross-session file management with business metadata

CREATE TABLE IF NOT EXISTS downloaded_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
  browser_session_id TEXT,

  -- File information
  filename TEXT NOT NULL,
  supabase_path TEXT NOT NULL,
  supabase_url TEXT,
  file_size BIGINT,
  content_type TEXT,

  -- Business metadata
  file_type TEXT NOT NULL, -- 'bank_statement', 'invoice', 'receipt', 'tax_document'
  practice_protect_name TEXT NOT NULL,
  bank_account_name TEXT NOT NULL,
  quickbooks_company_name TEXT NOT NULL,
  quickbooks_bank_account_name TEXT NOT NULL,

  -- Timestamps
  downloaded_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_downloaded_files_session ON downloaded_files(session_id);
CREATE INDEX IF NOT EXISTS idx_downloaded_files_browser_session ON downloaded_files(browser_session_id);
CREATE INDEX IF NOT EXISTS idx_downloaded_files_file_type ON downloaded_files(file_type);
CREATE INDEX IF NOT EXISTS idx_downloaded_files_practice ON downloaded_files(practice_protect_name);
CREATE INDEX IF NOT EXISTS idx_downloaded_files_metadata ON downloaded_files(
  practice_protect_name,
  bank_account_name,
  quickbooks_company_name,
  quickbooks_bank_account_name
);
CREATE INDEX IF NOT EXISTS idx_downloaded_files_downloaded_at ON downloaded_files(downloaded_at DESC);

-- Add RLS policies
ALTER TABLE downloaded_files ENABLE ROW LEVEL SECURITY;

-- Allow all operations (adjust based on your auth setup)
CREATE POLICY "Allow all operations on downloaded_files" ON downloaded_files
  FOR ALL USING (true) WITH CHECK (true);

-- Add comments for documentation
COMMENT ON TABLE downloaded_files IS 'Tracks files downloaded during browser sessions with business metadata for cross-session retrieval';
COMMENT ON COLUMN downloaded_files.file_type IS 'Type of file: bank_statement, invoice, receipt, tax_document';
COMMENT ON COLUMN downloaded_files.practice_protect_name IS 'Practice/client name for file organization';
COMMENT ON COLUMN downloaded_files.supabase_path IS 'Path in Supabase storage bucket cua-downloads';
