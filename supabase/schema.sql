-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Chat Sessions Table
CREATE TABLE chat_sessions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  browser_session_id TEXT,
  status TEXT CHECK (status IN ('active', 'paused', 'completed', 'error')) DEFAULT 'active',
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Messages Table
CREATE TABLE messages (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT CHECK (role IN ('user', 'assistant', 'tool')) NOT NULL,
  content TEXT NOT NULL,
  tool_calls JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Computer Actions Table (for audit trail)
CREATE TABLE computer_actions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  action_type TEXT CHECK (action_type IN ('click', 'type', 'scroll', 'screenshot', 'key')) NOT NULL,
  coordinates JSONB, -- {x: number, y: number}
  text TEXT,
  screenshot_url TEXT,
  risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high')) DEFAULT 'low',
  requires_approval BOOLEAN DEFAULT FALSE,
  approval_status TEXT CHECK (approval_status IN ('pending', 'approved', 'denied')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  executed_at TIMESTAMP WITH TIME ZONE,
  result JSONB,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Approval Requests Table
CREATE TABLE approval_requests (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
  action_id UUID REFERENCES computer_actions(id) ON DELETE CASCADE,
  gotohuman_form_id TEXT NOT NULL,
  status TEXT CHECK (status IN ('pending', 'approved', 'denied', 'timeout')) DEFAULT 'pending',
  screenshot_url TEXT,
  risk_assessment TEXT,
  approval_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolver_info JSONB,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Browser Sessions Table (to track Scrapybara sessions)
CREATE TABLE browser_sessions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  chat_session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
  scrapybara_session_id TEXT UNIQUE NOT NULL,
  status TEXT CHECK (status IN ('active', 'paused', 'stopped', 'error')) DEFAULT 'active',
  browser_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes for better performance
CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX idx_computer_actions_session_id ON computer_actions(session_id);
CREATE INDEX idx_computer_actions_created_at ON computer_actions(created_at DESC);
CREATE INDEX idx_approval_requests_status ON approval_requests(status);
CREATE INDEX idx_browser_sessions_scrapybara_id ON browser_sessions(scrapybara_session_id);

-- RLS (Row Level Security) Policies
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE computer_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE browser_sessions ENABLE ROW LEVEL SECURITY;

-- For now, allow all operations (you can add user-based policies later)
CREATE POLICY "Allow all operations on chat_sessions" ON chat_sessions FOR ALL USING (true);
CREATE POLICY "Allow all operations on messages" ON messages FOR ALL USING (true);
CREATE POLICY "Allow all operations on computer_actions" ON computer_actions FOR ALL USING (true);
CREATE POLICY "Allow all operations on approval_requests" ON approval_requests FOR ALL USING (true);
CREATE POLICY "Allow all operations on browser_sessions" ON browser_sessions FOR ALL USING (true);

-- Updated at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add updated_at triggers
CREATE TRIGGER update_chat_sessions_updated_at BEFORE UPDATE ON chat_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_browser_sessions_last_activity BEFORE UPDATE ON browser_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();