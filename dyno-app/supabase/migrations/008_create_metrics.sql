-- Agent metrics table — replaces local JSONL metric storage
-- Stores timestamped numeric values with optional metadata per user

CREATE TABLE IF NOT EXISTS agent_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metric_name text NOT NULL,
  value numeric NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for efficient queries by user + metric + time range
CREATE INDEX idx_agent_metrics_user_metric_time
ON agent_metrics (user_id, metric_name, timestamp DESC);

-- Index for listing distinct metric names per user
CREATE INDEX idx_agent_metrics_user_name
ON agent_metrics (user_id, metric_name);

-- Enable RLS
ALTER TABLE agent_metrics ENABLE ROW LEVEL SECURITY;

-- Users can only see their own metrics
CREATE POLICY "Users can read own metrics"
ON agent_metrics FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own metrics"
ON agent_metrics FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own metrics"
ON agent_metrics FOR DELETE
USING (auth.uid() = user_id);

-- Service role can access all metrics (for the agent backend)
CREATE POLICY "Service role full access to metrics"
ON agent_metrics FOR ALL
USING (auth.role() = 'service_role');
