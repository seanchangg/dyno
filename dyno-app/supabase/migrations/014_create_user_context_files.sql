-- Per-user context files (claude.md, soul.md, heartbeat.md, etc.)
CREATE TABLE IF NOT EXISTS user_context_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename text NOT NULL,
  content text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, filename)
);

CREATE INDEX idx_user_context_files_user ON user_context_files (user_id);

ALTER TABLE user_context_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own context files"
  ON user_context_files FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own context files"
  ON user_context_files FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own context files"
  ON user_context_files FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own context files"
  ON user_context_files FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access context files"
  ON user_context_files FOR ALL
  USING (auth.role() = 'service_role');
