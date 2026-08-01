-- Stub of the Supabase environment for local migration testing
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  -- Real Supabase has this; the awaiting-payment list reads it to
  -- show who has never signed in.
  last_sign_in_at TIMESTAMPTZ,
  raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ;

-- auth.uid() reads a session variable so tests can impersonate users
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid AS $$
  SELECT NULLIF(current_setting('test.uid', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text AS $$
  SELECT COALESCE(NULLIF(current_setting('test.role', true), ''), 'authenticated');
$$ LANGUAGE sql STABLE;
