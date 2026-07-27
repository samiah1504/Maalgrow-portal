-- ============================================================
-- The Payment Officer — migration 038
--
-- The role exists to work one queue and reach nothing else. That
-- claim is worth more than the feature: every write policy in this
-- portal is is_admin(), so a payment_officer added to that list would
-- have held write access to investors, investments, KYC and chats no
-- matter what the sidebar showed. The tests below are mostly about
-- what the role CANNOT do.
--
--   O1  an officer sees the queue, with the account number in full
--   O2  and cannot approve — off by default
--   O3  but can mark an approved request paid
--   O4  which records the date AND the person who did it
--   O5  approve and pay are two different people, both kept
--   O6  the switch turns approving on, and only a super admin may
--   O7  a pending request cannot be marked paid — nothing skips approval
--   O8  a paid request cannot be rejected afterwards
--   O9  the officer cannot read investors, investments or KYC
--   O10 nor write to payment_requests directly
--   O11 bulk: one bad row does not take the others down
--   O12 an investor cannot reach the queue at all
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id,email) VALUES
 ('a0000000-0000-0000-0000-0000000f0001','oadmin@t.com'),
 ('b0000000-0000-0000-0000-0000000f0001','officer@t.com'),
 ('10000000-0000-0000-0000-0000000f0001','oi1@t.com'),
 ('10000000-0000-0000-0000-0000000f0002','oi2@t.com') ON CONFLICT DO NOTHING;

INSERT INTO profiles (id,email,full_name,role) VALUES
 ('a0000000-0000-0000-0000-0000000f0001','oadmin@t.com','O Admin','super_admin'),
 ('b0000000-0000-0000-0000-0000000f0001','officer@t.com','Aminat Accountant','payment_officer'),
 ('10000000-0000-0000-0000-0000000f0001','oi1@t.com','O One','investor'),
 ('10000000-0000-0000-0000-0000000f0002','oi2@t.com','O Two','investor')
ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role;

INSERT INTO investors (id,profile_id,investor_code,full_name,email,phone,bank_name,account_name,account_number) VALUES
 ('20000000-0000-0000-0000-0000000f0001','10000000-0000-0000-0000-0000000f0001','MGO001','O One','oi1@t.com','08010000001','GTB','O One','0123456701'),
 ('20000000-0000-0000-0000-0000000f0002','10000000-0000-0000-0000-0000000f0002','MGO002','O Two','oi2@t.com','08010000002','Zenith','O Two','0123456702')
ON CONFLICT (id) DO NOTHING;

INSERT INTO series (id,name,description,start_month_offset,price_per_unit,mudarabah_investor_ratio)
 VALUES ('30000000-0000-0000-0000-0000000f0001','C','Series C',0,500000,0.50)
ON CONFLICT (name) DO UPDATE SET price_per_unit=EXCLUDED.price_per_unit;

INSERT INTO cycles (id,series_id,cycle_number,cycle_label,start_date,end_date,status,unit_value)
 VALUES ('40000000-0000-0000-0000-0000000f0001',(SELECT id FROM series WHERE name='C'),
   9501,'O-9501', CURRENT_DATE - 90, CURRENT_DATE, 'completed', 500000);

INSERT INTO investments (id,investment_code,investor_id,series_id,cycle_id,units,price_per_unit,capital,
  investment_date,maturity_date,status,declared_profit,declared_wht,declared_profit_net) VALUES
 ('50000000-0000-0000-0000-0000000f0001','O-1','20000000-0000-0000-0000-0000000f0001',
  (SELECT id FROM series WHERE name='C'),'40000000-0000-0000-0000-0000000f0001',
  2,500000,1000000,CURRENT_DATE-90,CURRENT_DATE,'matured',100000,10000,90000),
 ('50000000-0000-0000-0000-0000000f0002','O-2','20000000-0000-0000-0000-0000000f0002',
  (SELECT id FROM series WHERE name='C'),'40000000-0000-0000-0000-0000000f0001',
  1,500000,500000,CURRENT_DATE-90,CURRENT_DATE,'matured',50000,5000,45000);

INSERT INTO payment_requests (id,request_code,investor_id,investment_id,type,amount,
  bank_name,account_name,account_number,status) VALUES
 ('60000000-0000-0000-0000-0000000f0001','PR-O-1','20000000-0000-0000-0000-0000000f0001',
  '50000000-0000-0000-0000-0000000f0001','roi',90000,'GTB','O One','0123456701','pending'),
 ('60000000-0000-0000-0000-0000000f0002','PR-O-2','20000000-0000-0000-0000-0000000f0002',
  '50000000-0000-0000-0000-0000000f0002','roi',45000,'Zenith','O Two','0123456702','pending'),
 ('60000000-0000-0000-0000-0000000f0003','PR-O-3','20000000-0000-0000-0000-0000000f0001',
  '50000000-0000-0000-0000-0000000f0001','capital',1000000,'GTB','O One','0123456701','pending');

-- ------------------------------------------------------------
-- O1 — the officer sees the queue, account number and all
-- ------------------------------------------------------------
SELECT set_config('test.uid','b0000000-0000-0000-0000-0000000f0001',false);

DO $$ DECLARE v_n INT; v_acct TEXT; v_name TEXT; BEGIN
  SELECT COUNT(*) INTO v_n FROM payment_request_queue('pending');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL O1: the officer sees % pending, expected 3', v_n;
  END IF;

  SELECT account_number, investor_name INTO v_acct, v_name
    FROM payment_request_queue('pending') WHERE request_code = 'PR-O-1';
  IF v_acct <> '0123456701' THEN
    RAISE EXCEPTION 'TEST FAIL O1: the account number is not readable in full — got %', v_acct;
  END IF;
  IF v_name <> 'O One' THEN
    RAISE EXCEPTION 'TEST FAIL O1: the investor cannot be identified — got %', v_name;
  END IF;
  RAISE NOTICE 'PASS O1 — the queue is readable, account % in full', v_acct;
END $$;

-- ------------------------------------------------------------
-- O2 — and cannot approve. Off by default.
-- ------------------------------------------------------------
DO $$ DECLARE v_msg TEXT; BEGIN
  IF (my_payment_permissions()->>'canAuthorise')::BOOLEAN THEN
    RAISE EXCEPTION 'TEST FAIL O2: the page would show an Approve button';
  END IF;

  BEGIN
    PERFORM approve_payment_request('60000000-0000-0000-0000-0000000f0001');
    RAISE EXCEPTION 'TEST FAIL O2: the officer approved a payment';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;

  IF v_msg NOT LIKE '%switched off%' THEN
    RAISE EXCEPTION 'TEST FAIL O2: the refusal does not say why — %', v_msg;
  END IF;
  RAISE NOTICE 'PASS O2 — refused with: %', v_msg;
END $$;

-- ------------------------------------------------------------
-- O7 — and cannot skip approval by paying a pending request
-- ------------------------------------------------------------
DO $$ DECLARE v_msg TEXT; BEGIN
  BEGIN
    PERFORM mark_payment_request_paid('60000000-0000-0000-0000-0000000f0001');
    RAISE EXCEPTION 'TEST FAIL O7: a pending request was marked paid without approval';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;
  IF v_msg NOT LIKE '%only an approved request%' THEN
    RAISE EXCEPTION 'TEST FAIL O7: refused for the wrong reason — %', v_msg;
  END IF;
  RAISE NOTICE 'PASS O7 — approval cannot be skipped: %', v_msg;
END $$;

-- ------------------------------------------------------------
-- O9 / O10 — the role reaches nothing else.
--
--   The whole reason payment_officer is not in is_admin().
-- ------------------------------------------------------------
DO $$ DECLARE v_n INT; BEGIN
  -- is_admin() is what every other table's policy tests. If this ever
  -- returns true the confinement is gone, whatever the sidebar shows.
  IF is_admin() THEN
    RAISE EXCEPTION 'TEST FAIL O9: the payment officer counts as an admin';
  END IF;

  IF is_payment_officer() IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAIL O9: the role was not recognised at all';
  END IF;

  -- And the tables those policies guard are shut to them.
  IF (SELECT COUNT(*) FROM investors WHERE is_admin()) <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL O9: investors are reachable';
  END IF;

  RAISE NOTICE 'PASS O9/O10 — not an admin, so every is_admin() policy refuses';
END $$;

-- ------------------------------------------------------------
-- O5 (part 1) — an ADMIN approves. Two people, not one.
-- ------------------------------------------------------------
SELECT set_config('test.uid','a0000000-0000-0000-0000-0000000f0001',false);

DO $$ DECLARE v JSONB; BEGIN
  v := approve_payment_request('60000000-0000-0000-0000-0000000f0001');
  IF NOT (v->>'changed')::BOOLEAN THEN
    RAISE EXCEPTION 'TEST FAIL O5: the admin could not approve';
  END IF;

  IF (SELECT approved_by FROM payment_requests WHERE id='60000000-0000-0000-0000-0000000f0001')
     IS DISTINCT FROM 'a0000000-0000-0000-0000-0000000f0001' THEN
    RAISE EXCEPTION 'TEST FAIL O5: the approver was not recorded';
  END IF;

  -- Approving twice is not an error; it just does nothing.
  v := approve_payment_request('60000000-0000-0000-0000-0000000f0001');
  IF (v->>'changed')::BOOLEAN THEN
    RAISE EXCEPTION 'TEST FAIL O5: a second approval changed something';
  END IF;
  RAISE NOTICE 'PASS O5a — approved by the admin, and idempotent';
END $$;

-- ------------------------------------------------------------
-- O3 / O4 / O5 (part 2) — the OFFICER pays it
-- ------------------------------------------------------------
SELECT set_config('test.uid','b0000000-0000-0000-0000-0000000f0001',false);

DO $$
DECLARE v JSONB; v_req payment_requests%ROWTYPE; v_notes INT;
BEGIN
  v := mark_payment_request_paid('60000000-0000-0000-0000-0000000f0001', NULL, 'GTB/TRF/8891');
  IF NOT (v->>'changed')::BOOLEAN THEN
    RAISE EXCEPTION 'TEST FAIL O3: the officer could not mark it paid';
  END IF;

  SELECT * INTO v_req FROM payment_requests WHERE id='60000000-0000-0000-0000-0000000f0001';

  IF v_req.status::TEXT <> 'paid' THEN
    RAISE EXCEPTION 'TEST FAIL O3: status is %, expected paid', v_req.status;
  END IF;
  IF v_req.paid_at IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL O4: no payment date was recorded';
  END IF;
  IF v_req.paid_by IS DISTINCT FROM 'b0000000-0000-0000-0000-0000000f0001' THEN
    RAISE EXCEPTION 'TEST FAIL O4: the officer was not recorded as the payer';
  END IF;
  IF v_req.payment_ref <> 'GTB/TRF/8891' THEN
    RAISE EXCEPTION 'TEST FAIL O4: the bank reference was not kept';
  END IF;

  -- O5: BOTH people survive. reviewed_by used to overwrite one with
  -- the other, so the approver was erased by whoever paid.
  IF v_req.approved_by IS DISTINCT FROM 'a0000000-0000-0000-0000-0000000f0001' THEN
    RAISE EXCEPTION 'TEST FAIL O5: paying erased who approved';
  END IF;

  -- and the investor is told
  SELECT COUNT(*) INTO v_notes FROM notifications
   WHERE user_id = '10000000-0000-0000-0000-0000000f0001'
     AND type::TEXT = 'payment' AND title LIKE '%Profit Has Been Paid%';
  IF v_notes <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL O3: the investor was not notified (% notices)', v_notes;
  END IF;

  RAISE NOTICE 'PASS O3/O4/O5 — paid by the officer, approved by the admin, both kept';
END $$;

-- ------------------------------------------------------------
-- O8 — and money that has left cannot be un-sent by a status change
-- ------------------------------------------------------------
SELECT set_config('test.uid','a0000000-0000-0000-0000-0000000f0001',false);

DO $$ DECLARE v_msg TEXT; BEGIN
  BEGIN
    PERFORM reject_payment_request('60000000-0000-0000-0000-0000000f0001', 'changed my mind');
    RAISE EXCEPTION 'TEST FAIL O8: a paid request was rejected';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;
  IF v_msg NOT LIKE '%already been paid%' THEN
    RAISE EXCEPTION 'TEST FAIL O8: refused for the wrong reason — %', v_msg;
  END IF;
  RAISE NOTICE 'PASS O8 — %', v_msg;
END $$;

-- ------------------------------------------------------------
-- O6 — the switch, and who may throw it
-- ------------------------------------------------------------
SELECT set_config('test.uid','b0000000-0000-0000-0000-0000000f0001',false);

DO $$ DECLARE v_msg TEXT; BEGIN
  BEGIN
    PERFORM set_payment_officer_can_approve(TRUE);
    RAISE EXCEPTION 'TEST FAIL O6: the officer granted themselves approval';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;
  IF v_msg NOT LIKE '%super admin%' THEN
    RAISE EXCEPTION 'TEST FAIL O6: refused for the wrong reason — %', v_msg;
  END IF;
  RAISE NOTICE 'PASS O6a — an officer cannot switch it on themselves: %', v_msg;
END $$;

SELECT set_config('test.uid','a0000000-0000-0000-0000-0000000f0001',false);
SELECT set_payment_officer_can_approve(TRUE);

SELECT set_config('test.uid','b0000000-0000-0000-0000-0000000f0001',false);

DO $$ DECLARE v JSONB; BEGIN
  IF NOT (my_payment_permissions()->>'canAuthorise')::BOOLEAN THEN
    RAISE EXCEPTION 'TEST FAIL O6: the switch did not reach the page';
  END IF;

  v := approve_payment_request('60000000-0000-0000-0000-0000000f0002');
  IF NOT (v->>'changed')::BOOLEAN THEN
    RAISE EXCEPTION 'TEST FAIL O6: the officer still cannot approve with it on';
  END IF;
  RAISE NOTICE 'PASS O6b — switched on, the officer can approve';
END $$;

-- and back off again
SELECT set_config('test.uid','a0000000-0000-0000-0000-0000000f0001',false);
SELECT set_payment_officer_can_approve(FALSE);

SELECT set_config('test.uid','b0000000-0000-0000-0000-0000000f0001',false);

DO $$ BEGIN
  IF (my_payment_permissions()->>'canAuthorise')::BOOLEAN THEN
    RAISE EXCEPTION 'TEST FAIL O6: switching it back off did not take';
  END IF;
  RAISE NOTICE 'PASS O6c — and off again';
END $$;

-- ------------------------------------------------------------
-- O11 — bulk: one bad row does not take the others down.
--
--   PR-O-2 is approved and will pay. PR-O-3 is still pending and
--   must fail on its own without stopping the batch.
-- ------------------------------------------------------------
DO $$ DECLARE v JSONB; BEGIN
  v := process_payment_requests(
    ARRAY['60000000-0000-0000-0000-0000000f0002'::UUID,
          '60000000-0000-0000-0000-0000000f0003'::UUID],
    'paid');

  IF (v->>'succeeded')::INT <> 1 OR (v->>'failed')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL O11: expected 1 paid and 1 refused, got %', v::TEXT;
  END IF;

  IF (SELECT status::TEXT FROM payment_requests WHERE id='60000000-0000-0000-0000-0000000f0002') <> 'paid' THEN
    RAISE EXCEPTION 'TEST FAIL O11: the good row did not go through';
  END IF;
  IF (SELECT status::TEXT FROM payment_requests WHERE id='60000000-0000-0000-0000-0000000f0003') <> 'pending' THEN
    RAISE EXCEPTION 'TEST FAIL O11: the bad row was paid anyway';
  END IF;

  -- and the reason for the one that failed comes back with it
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v->'results') e
     WHERE (e->>'ok')::BOOLEAN IS FALSE AND e->>'error' LIKE '%only an approved request%'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL O11: the failure came back without a reason — %', v::TEXT;
  END IF;

  RAISE NOTICE 'PASS O11 — 1 paid, 1 refused with its own reason';
END $$;

-- ------------------------------------------------------------
-- O12 — an investor cannot reach the queue at all
-- ------------------------------------------------------------
SELECT set_config('test.uid','10000000-0000-0000-0000-0000000f0001',false);

DO $$ DECLARE v_n INT; v_msg TEXT; BEGIN
  SELECT COUNT(*) INTO v_n FROM payment_request_queue(NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL O12: an investor read % rows of the payment queue', v_n;
  END IF;

  BEGIN
    PERFORM mark_payment_request_paid('60000000-0000-0000-0000-0000000f0003');
    RAISE EXCEPTION 'TEST FAIL O12: an investor marked their own request paid';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;

  IF (my_payment_permissions()->>'canProcess')::BOOLEAN THEN
    RAISE EXCEPTION 'TEST FAIL O12: an investor is told they can process payments';
  END IF;
  RAISE NOTICE 'PASS O12 — nothing of the queue is reachable: %', v_msg;
END $$;

ROLLBACK;
