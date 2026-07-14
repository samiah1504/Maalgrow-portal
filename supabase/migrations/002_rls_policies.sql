-- ============================================================
-- Row Level Security Policies
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE investors ENABLE ROW LEVEL SECURITY;
ALTER TABLE series ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE investments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user's role
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function to check if user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
  SELECT role IN ('super_admin', 'administrator', 'finance', 'operations', 'customer_support')
  FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function to check if user is investor
CREATE OR REPLACE FUNCTION is_investor()
RETURNS boolean AS $$
  SELECT role = 'investor' FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function to get investor_id for current user
CREATE OR REPLACE FUNCTION get_my_investor_id()
RETURNS uuid AS $$
  SELECT id FROM investors WHERE profile_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- PROFILES POLICIES
-- ============================================================

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT
  USING (is_admin());

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = (SELECT role FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can update any profile"
  ON profiles FOR UPDATE
  USING (is_admin());

-- ============================================================
-- INVESTORS POLICIES
-- ============================================================

CREATE POLICY "Investors can view own record"
  ON investors FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "Admins can view all investors"
  ON investors FOR SELECT
  USING (is_admin());

CREATE POLICY "Investors can update own bank details"
  ON investors FOR UPDATE
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Admins can manage all investors"
  ON investors FOR ALL
  USING (is_admin());

-- ============================================================
-- SERIES POLICIES
-- ============================================================

CREATE POLICY "Anyone authenticated can view active series"
  ON series FOR SELECT
  USING (auth.uid() IS NOT NULL AND is_active = true);

CREATE POLICY "Admins can manage series"
  ON series FOR ALL
  USING (is_admin());

-- ============================================================
-- CYCLES POLICIES
-- ============================================================

CREATE POLICY "Anyone authenticated can view cycles"
  ON cycles FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage cycles"
  ON cycles FOR ALL
  USING (is_admin());

-- ============================================================
-- INVESTMENTS POLICIES
-- ============================================================

CREATE POLICY "Investors can view own investments"
  ON investments FOR SELECT
  USING (investor_id = get_my_investor_id());

CREATE POLICY "Admins can view all investments"
  ON investments FOR SELECT
  USING (is_admin());

CREATE POLICY "Investors can update own maturity decision"
  ON investments FOR UPDATE
  USING (investor_id = get_my_investor_id())
  WITH CHECK (investor_id = get_my_investor_id());

CREATE POLICY "Admins can manage all investments"
  ON investments FOR ALL
  USING (is_admin());

-- ============================================================
-- PAYMENT REQUESTS POLICIES
-- ============================================================

CREATE POLICY "Investors can view own payment requests"
  ON payment_requests FOR SELECT
  USING (investor_id = get_my_investor_id());

CREATE POLICY "Investors can create own payment requests"
  ON payment_requests FOR INSERT
  WITH CHECK (investor_id = get_my_investor_id());

CREATE POLICY "Admins can manage all payment requests"
  ON payment_requests FOR ALL
  USING (is_admin());

-- ============================================================
-- NOTIFICATIONS POLICIES
-- ============================================================

CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can create notifications"
  ON notifications FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "System can create notifications"
  ON notifications FOR INSERT
  WITH CHECK (true);  -- Will be restricted via service role only

-- ============================================================
-- DOCUMENTS POLICIES
-- ============================================================

CREATE POLICY "Investors can view own visible documents"
  ON documents FOR SELECT
  USING (
    investor_id = get_my_investor_id()
    AND is_visible_to_investor = true
  );

CREATE POLICY "Admins can manage all documents"
  ON documents FOR ALL
  USING (is_admin());

-- ============================================================
-- AUDIT LOGS POLICIES
-- ============================================================

CREATE POLICY "Admins can view audit logs"
  ON audit_logs FOR SELECT
  USING (is_admin());

CREATE POLICY "System can insert audit logs"
  ON audit_logs FOR INSERT
  WITH CHECK (true);  -- Restricted via service role

-- ============================================================
-- ANNOUNCEMENTS POLICIES
-- ============================================================

CREATE POLICY "Users can view published announcements"
  ON announcements FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND is_published = true
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (
      target_audience = 'all'
      OR (target_audience = 'investors' AND is_investor())
      OR (target_audience = 'admins' AND is_admin())
    )
  );

CREATE POLICY "Admins can manage announcements"
  ON announcements FOR ALL
  USING (is_admin());
