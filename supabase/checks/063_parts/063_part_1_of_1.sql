-- MaalRise 063: MaalRise follows edits made on the investor Edit page.
-- ONE PART. Run ONCE, after the 063 preflight. Success = 063 applied
BEGIN;
DO $$ BEGIN
IF to_regprocedure('public.maalrise_release_held_payments(uuid)') IS NULL THEN
RAISE EXCEPTION 'STOP: run migration 062 first.';
END IF;
IF to_regprocedure('public.maalrise_bank_from_maalgrow_edit(uuid,uuid)') IS NOT NULL THEN
RAISE EXCEPTION 'STOP: 063 has already been applied. Do not run it again.';
END IF;
END $$;
-- >>> 063 BODY START

CREATE OR REPLACE FUNCTION maalrise_email_from_login_trg()
RETURNS TRIGGER AS $$
DECLARE
v_new TEXT := lower(trim(NEW.email));
v_m   maalrise_investors%ROWTYPE;
BEGIN
IF NEW.email IS NOT DISTINCT FROM OLD.email OR v_new IS NULL OR v_new NOT LIKE '%@%' THEN RETURN NULL; END IF;
BEGIN
SELECT * INTO v_m FROM maalrise_investors WHERE profile_id = NEW.id;
IF FOUND AND v_m.email <> v_new THEN
UPDATE maalrise_investors SET email = v_new, updated_at = NOW() WHERE id = v_m.id;
PERFORM create_audit_log('maalrise_email_from_login', 'maalrise_investor', v_m.id::TEXT,
jsonb_build_object('email', v_m.email), jsonb_build_object('email', v_new));
END IF;
EXCEPTION WHEN OTHERS THEN
RAISE WARNING 'MaalRise could not follow the new email for login % (%)', NEW.id, SQLERRM;
END;
RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER maalrise_email_from_login
AFTER UPDATE OF email ON profiles
FOR EACH ROW EXECUTE FUNCTION maalrise_email_from_login_trg();

CREATE OR REPLACE FUNCTION maalrise_contact_from_maalgrow_trg()
RETURNS TRIGGER AS $$
DECLARE
r      maalrise_investors%ROWTYPE;
v_name TEXT;
v_ph   TEXT;
BEGIN
IF NEW.full_name IS NOT DISTINCT FROM OLD.full_name AND NEW.phone IS NOT DISTINCT FROM OLD.phone THEN RETURN NULL; END IF;
BEGIN
FOR r IN SELECT * FROM maalrise_investors
WHERE maalgrow_investor_id = NEW.id OR (maalgrow_investor_id IS NULL AND profile_id = NEW.profile_id) LOOP
v_name := CASE WHEN NEW.full_name IS DISTINCT FROM OLD.full_name AND NULLIF(trim(NEW.full_name), '') IS NOT NULL
THEN trim(NEW.full_name) ELSE r.full_name END;
v_ph := CASE WHEN NEW.phone IS DISTINCT FROM OLD.phone THEN NULLIF(trim(NEW.phone), '') ELSE r.phone END;
IF v_name IS DISTINCT FROM r.full_name OR v_ph IS DISTINCT FROM r.phone THEN
UPDATE maalrise_investors SET full_name = v_name, phone = v_ph, updated_at = NOW() WHERE id = r.id;
PERFORM create_audit_log('maalrise_contact_from_maalgrow', 'maalrise_investor', r.id::TEXT,
jsonb_build_object('full_name', r.full_name, 'phone', r.phone), jsonb_build_object('full_name', v_name, 'phone', v_ph));
END IF;
END LOOP;
EXCEPTION WHEN OTHERS THEN
RAISE WARNING 'MaalRise could not follow the name or phone of MaalGrow investor % (%)', NEW.id, SQLERRM;
END;
RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER maalrise_contact_from_maalgrow
AFTER UPDATE OF full_name, phone ON investors
FOR EACH ROW EXECUTE FUNCTION maalrise_contact_from_maalgrow_trg();

CREATE OR REPLACE FUNCTION maalrise_bank_from_maalgrow_edit(p_maalgrow UUID, p_actor UUID)
RETURNS JSONB AS $$
DECLARE
g       investors%ROWTYPE;
m       maalrise_investors%ROWTYPE;
v_bank  TEXT;
v_name  TEXT;
v_moved INTEGER;
v_cap   INTEGER;
BEGIN
IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_actor AND role::TEXT IN ('super_admin', 'administrator')) THEN
RAISE EXCEPTION 'Only a super admin or administrator can change bank details';
END IF;
SELECT * INTO g FROM investors WHERE id = p_maalgrow;
IF NOT FOUND THEN RAISE EXCEPTION 'Investor not found'; END IF;
SELECT * INTO m FROM maalrise_investors
WHERE maalgrow_investor_id = g.id OR (maalgrow_investor_id IS NULL AND profile_id = g.profile_id)
LIMIT 1 FOR UPDATE;
IF NOT FOUND THEN RETURN jsonb_build_object('updated', FALSE, 'reason', 'not_maalrise'); END IF;
v_bank := NULLIF(trim(g.bank_name), '');
v_name := NULLIF(trim(g.account_name), '');
IF v_bank IS NULL OR v_name IS NULL OR COALESCE(g.account_number !~ '^[0-9]{10}$', TRUE) THEN
RETURN jsonb_build_object('updated', FALSE, 'reason', 'incomplete');
END IF;
IF m.bank_confirmed_at IS NOT NULL AND m.bank_name = v_bank AND m.account_name = v_name AND m.account_number = g.account_number THEN
RETURN jsonb_build_object('updated', FALSE, 'reason', 'unchanged');
END IF;
-- Unpaid payments to a different account go on hold; confirming below releases them to the new account
UPDATE maalrise_distribution_lines SET status = 'on_hold', updated_at = NOW()
WHERE maalrise_investor_id = m.id AND status = 'payable' AND account_number IS DISTINCT FROM g.account_number;
GET DIAGNOSTICS v_moved = ROW_COUNT;
UPDATE maalrise_capital_payments SET status = 'on_hold', updated_at = NOW()
WHERE maalrise_investor_id = m.id AND status = 'payable' AND account_number IS DISTINCT FROM g.account_number;
GET DIAGNOSTICS v_cap = ROW_COUNT;
UPDATE maalrise_investors
SET bank_name = v_bank, account_name = v_name, account_number = g.account_number,
bank_confirmed_by = p_actor, bank_confirmed_at = NOW(), maalgrow_investor_id = g.id, updated_at = NOW()
WHERE id = m.id;
INSERT INTO maalrise_bank_details_history (maalrise_investor_id, event, bank_name, account_name, account_number, actor)
VALUES (m.id, 'set', v_bank, v_name, g.account_number, p_actor),
(m.id, 'confirmed', v_bank, v_name, g.account_number, p_actor);
PERFORM create_audit_log('maalrise_bank_from_maalgrow_edit', 'maalrise_investor', m.id::TEXT,
jsonb_build_object('account_ending', right(m.account_number, 4), 'confirmed', m.bank_confirmed_at IS NOT NULL),
jsonb_build_object('account_ending', right(g.account_number, 4), 'confirmed', TRUE, 'by', p_actor,
'unpaid_moved', v_moved + v_cap));
RETURN jsonb_build_object('updated', TRUE, 'moved', v_moved + v_cap);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION maalrise_email_from_login_trg() FROM PUBLIC;
REVOKE ALL ON FUNCTION maalrise_contact_from_maalgrow_trg() FROM PUBLIC;
REVOKE ALL ON FUNCTION maalrise_bank_from_maalgrow_edit(UUID, UUID) FROM PUBLIC;
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
REVOKE EXECUTE ON FUNCTION maalrise_email_from_login_trg() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION maalrise_contact_from_maalgrow_trg() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION maalrise_bank_from_maalgrow_edit(UUID, UUID) FROM anon, authenticated;
END IF;
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
GRANT EXECUTE ON FUNCTION maalrise_bank_from_maalgrow_edit(UUID, UUID) TO service_role;
END IF;
END $$;

-- One-time correction: MaalRise email = login email
DO $$
DECLARE r RECORD;
BEGIN
FOR r IN SELECT m.id, m.email AS old_email, lower(trim(p.email)) AS new_email
FROM maalrise_investors m JOIN profiles p ON p.id = m.profile_id
WHERE p.email LIKE '%@%' AND m.email <> lower(trim(p.email)) LOOP
UPDATE maalrise_investors SET email = r.new_email, updated_at = NOW() WHERE id = r.id;
PERFORM create_audit_log('maalrise_email_from_login', 'maalrise_investor', r.id::TEXT,
jsonb_build_object('email', r.old_email), jsonb_build_object('email', r.new_email, 'one_time_correction', TRUE));
END LOOP;
END $$;

-- <<< 063 BODY END
COMMIT;
SELECT '063 applied' AS result;
