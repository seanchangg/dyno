-- Create storage buckets for user workspaces
-- Each bucket uses RLS to isolate users to their own {user_id}/* paths

-- Workspace bucket (private) — user files, skills, data
INSERT INTO storage.buckets (id, name, public)
VALUES ('workspace', 'workspace', false)
ON CONFLICT (id) DO NOTHING;

-- Uploads bucket (private) — user-uploaded files
INSERT INTO storage.buckets (id, name, public)
VALUES ('uploads', 'uploads', false)
ON CONFLICT (id) DO NOTHING;

-- Scripts bucket (private) — saved scripts
INSERT INTO storage.buckets (id, name, public)
VALUES ('scripts', 'scripts', false)
ON CONFLICT (id) DO NOTHING;

-- Widgets bucket (public read) — HTML widgets served to dashboard
INSERT INTO storage.buckets (id, name, public)
VALUES ('widgets', 'widgets', true)
ON CONFLICT (id) DO NOTHING;

-- ── RLS policies for workspace bucket ────────────────────────────────────

CREATE POLICY "Users can read own workspace files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'workspace'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can upload to own workspace"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'workspace'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can update own workspace files"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'workspace'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete own workspace files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'workspace'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- ── RLS policies for uploads bucket ──────────────────────────────────────

CREATE POLICY "Users can read own uploads"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'uploads'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can upload to own uploads"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'uploads'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete own uploads"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'uploads'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- ── RLS policies for scripts bucket ──────────────────────────────────────

CREATE POLICY "Users can read own scripts"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'scripts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can upload own scripts"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'scripts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete own scripts"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'scripts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- ── RLS policies for widgets bucket ──────────────────────────────────────

-- Public read for widgets (served to dashboard)
CREATE POLICY "Anyone can read widgets"
ON storage.objects FOR SELECT
USING (bucket_id = 'widgets');

CREATE POLICY "Users can upload own widgets"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'widgets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can update own widgets"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'widgets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete own widgets"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'widgets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
