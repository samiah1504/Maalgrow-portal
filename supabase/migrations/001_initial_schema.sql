-- ============================================================
-- MaalVest MaalGrow Platform - Initial Schema
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM (
  'super_admin',
  'administrator',
  'finance',
  'operations',
  'customer_support',
  'investor'
);

CREATE TYPE investment_status AS ENUM ('active', 'matured', 'completed');
CREATE TYPE payment_status AS ENUM ('pending', 'approved', 'processing', 'paid', 'rejected');
CREATE TYPE kyc_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE series_name AS ENUM ('A', 'B', 'C');
CREATE TYPE cycle_status AS ENUM ('upcoming', 'active', 'matured', 'completed');
CREATE TYPE payment_type AS ENUM ('roi', 'capital');
CREATE TYPE notification_type AS ENUM (
  'investment', 'roi', 'capital', 'maturity', 'payment',
  'document', 'announcement', 'system'
);
CREATE TYPE document_type AS ENUM (
  'agreement', 'certificate', 'statement', 'receipt', 'report', 'other'
);
CREATE TYPE target_audience AS ENUM ('all', 'investors', 'admins');
CREATE TYPE maturity_decision AS ENUM ('continue', 'exit');

-- ============================================================
-- PROFILES TABLE (extends auth.users)
-- ============================================================

CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE,
  full_name     TEXT,
  phone         TEXT,
  avatar_url    TEXT,
  role          user_role NOT NULL DEFAULT 'investor',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INVESTORS TABLE
-- ============================================================

CREATE TABLE investors (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  investor_code   TEXT NOT NULL UNIQUE,
  full_name       TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  phone           TEXT,
  address         TEXT,
  bvn             TEXT,
  nin             TEXT,
  bank_name       TEXT,
  account_name    TEXT,
  account_number  TEXT,
  kyc_status      kyc_status NOT NULL DEFAULT 'pending',
  kyc_notes       TEXT,
  onboarded_at    TIMESTAMPTZ,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SERIES TABLE
-- ============================================================

CREATE TABLE series (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  series_name NOT NULL UNIQUE,
  description           TEXT,
  start_month_offset    INTEGER NOT NULL CHECK (start_month_offset BETWEEN 0 AND 2),
  -- offset 0=Jan(A), 1=Feb(B), 2=Mar(C)
  roi_rate              NUMERIC(6,4) NOT NULL CHECK (roi_rate > 0),
  price_per_unit        NUMERIC(15,2) NOT NULL CHECK (price_per_unit > 0),
  min_units             INTEGER NOT NULL DEFAULT 1,
  max_units             INTEGER,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CYCLES TABLE
-- ============================================================

CREATE TABLE cycles (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  series_id                UUID NOT NULL REFERENCES series(id),
  cycle_number             INTEGER NOT NULL,
  cycle_label              TEXT NOT NULL,
  start_date               DATE NOT NULL,
  end_date                 DATE NOT NULL,
  status                   cycle_status NOT NULL DEFAULT 'upcoming',
  total_capital            NUMERIC(20,2) NOT NULL DEFAULT 0,
  total_investors          INTEGER NOT NULL DEFAULT 0,
  maturity_processed_at    TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (series_id, cycle_number),
  CHECK (end_date > start_date)
);

-- ============================================================
-- INVESTMENTS TABLE
-- ============================================================

CREATE TABLE investments (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investment_code       TEXT NOT NULL UNIQUE,
  investor_id           UUID NOT NULL REFERENCES investors(id),
  series_id             UUID NOT NULL REFERENCES series(id),
  cycle_id              UUID NOT NULL REFERENCES cycles(id),
  units                 INTEGER NOT NULL CHECK (units > 0),
  price_per_unit        NUMERIC(15,2) NOT NULL,
  capital               NUMERIC(20,2) NOT NULL,
  roi_rate              NUMERIC(6,4) NOT NULL,
  expected_roi          NUMERIC(20,2) NOT NULL,
  investment_date       DATE NOT NULL,
  maturity_date         DATE NOT NULL,
  status                investment_status NOT NULL DEFAULT 'active',
  maturity_decision     maturity_decision,
  maturity_decided_at   TIMESTAMPTZ,
  next_investment_id    UUID REFERENCES investments(id),
  parent_investment_id  UUID REFERENCES investments(id),
  notes                 TEXT,
  created_by            UUID REFERENCES profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PAYMENT REQUESTS TABLE
-- ============================================================

CREATE TABLE payment_requests (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_code      TEXT NOT NULL UNIQUE,
  investor_id       UUID NOT NULL REFERENCES investors(id),
  investment_id     UUID NOT NULL REFERENCES investments(id),
  type              payment_type NOT NULL,
  amount            NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  bank_name         TEXT NOT NULL,
  account_name      TEXT NOT NULL,
  account_number    TEXT NOT NULL,
  notes             TEXT,
  status            payment_status NOT NULL DEFAULT 'pending',
  reviewed_by       UUID REFERENCES profiles(id),
  reviewed_at       TIMESTAMPTZ,
  paid_at           TIMESTAMPTZ,
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS TABLE
-- ============================================================

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  type        notification_type NOT NULL,
  is_read     BOOLEAN NOT NULL DEFAULT false,
  action_url  TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- DOCUMENTS TABLE
-- ============================================================

CREATE TABLE documents (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investor_id             UUID REFERENCES investors(id) ON DELETE CASCADE,
  investment_id           UUID REFERENCES investments(id) ON DELETE SET NULL,
  type                    document_type NOT NULL,
  name                    TEXT NOT NULL,
  file_path               TEXT NOT NULL,
  file_size               BIGINT NOT NULL,
  mime_type               TEXT NOT NULL,
  uploaded_by             UUID REFERENCES profiles(id),
  is_visible_to_investor  BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOGS TABLE
-- ============================================================

CREATE TABLE audit_logs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  old_values   JSONB,
  new_values   JSONB,
  ip_address   INET,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ANNOUNCEMENTS TABLE
-- ============================================================

CREATE TABLE announcements (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title            TEXT NOT NULL,
  content          TEXT NOT NULL,
  target_audience  target_audience NOT NULL DEFAULT 'investors',
  is_published     BOOLEAN NOT NULL DEFAULT false,
  published_at     TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,
  created_by       UUID REFERENCES profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_investors_profile_id ON investors(profile_id);
CREATE INDEX idx_investors_email ON investors(email);
CREATE INDEX idx_investors_investor_code ON investors(investor_code);

CREATE INDEX idx_cycles_series_id ON cycles(series_id);
CREATE INDEX idx_cycles_status ON cycles(status);
CREATE INDEX idx_cycles_end_date ON cycles(end_date);

CREATE INDEX idx_investments_investor_id ON investments(investor_id);
CREATE INDEX idx_investments_series_id ON investments(series_id);
CREATE INDEX idx_investments_cycle_id ON investments(cycle_id);
CREATE INDEX idx_investments_status ON investments(status);
CREATE INDEX idx_investments_maturity_date ON investments(maturity_date);
CREATE INDEX idx_investments_investment_code ON investments(investment_code);

CREATE INDEX idx_payment_requests_investor_id ON payment_requests(investor_id);
CREATE INDEX idx_payment_requests_investment_id ON payment_requests(investment_id);
CREATE INDEX idx_payment_requests_status ON payment_requests(status);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);

CREATE INDEX idx_documents_investor_id ON documents(investor_id);
CREATE INDEX idx_documents_investment_id ON documents(investment_id);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity_type ON audit_logs(entity_type);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_investors_updated_at
  BEFORE UPDATE ON investors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_series_updated_at
  BEFORE UPDATE ON series
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cycles_updated_at
  BEFORE UPDATE ON cycles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_investments_updated_at
  BEFORE UPDATE ON investments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_requests_updated_at
  BEFORE UPDATE ON payment_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_announcements_updated_at
  BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- AUTO-CREATE PROFILE ON AUTH USER CREATION
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'investor')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
