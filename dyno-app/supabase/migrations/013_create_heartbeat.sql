-- heartbeat_log: per-tick telemetry for autonomous heartbeat daemon
CREATE TABLE IF NOT EXISTS heartbeat_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  triage_model text NOT NULL,
  triage_tokens_in bigint NOT NULL DEFAULT 0,
  triage_tokens_out bigint NOT NULL DEFAULT 0,
  escalated boolean NOT NULL DEFAULT false,
  action_model text,
  action_tokens_in bigint NOT NULL DEFAULT 0,
  action_tokens_out bigint NOT NULL DEFAULT 0,
  total_cost_usd numeric(12,8) NOT NULL DEFAULT 0,
  summary text,
  status text NOT NULL DEFAULT 'ok'  -- ok, escalated, error, budget_exceeded
);

CREATE INDEX idx_heartbeat_log_user_time ON heartbeat_log (user_id, triggered_at DESC);
ALTER TABLE heartbeat_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own heartbeat log" ON heartbeat_log
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role full access heartbeat" ON heartbeat_log
  FOR ALL USING (auth.role() = 'service_role');

-- Daily cost RPC: sum total_cost_usd for the current day
CREATE OR REPLACE FUNCTION get_daily_heartbeat_cost(p_user_id uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(total_cost_usd), 0)
  FROM heartbeat_log
  WHERE user_id = p_user_id AND triggered_at >= date_trunc('day', now());
$$;

-- Cleanup logs older than 30 days
CREATE OR REPLACE FUNCTION cleanup_old_heartbeat_logs()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM heartbeat_log WHERE triggered_at < now() - interval '30 days';
$$;
