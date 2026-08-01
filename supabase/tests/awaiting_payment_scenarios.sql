-- ============================================================
-- The investors nobody is chasing — migration 044
--
-- Every other screen starts from a payment_requests row, so an
-- investor who has none is invisible. These check that the list finds
-- them, and — the part that matters — that it says WHY, because "no
-- payment request" is three different problems wearing one label.
--
--   G1  an investor who has not answered is listed as no_instruction
--   G2  an investor who answered but has no bank account is listed
--       as no_bank_details — the silent failure
--   G3  an investor with a request is NOT listed
--   G4  a rejected request still counts as no request
--   G5  a legacy rollover_all is listed, but as nothing_payable, and
--       is excluded from the outstanding counts
--   G6  days_waiting is measured from settlement
--   G7  the counts split by reason and by age
--   G8  recording an instruction removes them from the list, because
--       it raises the request
--   G9  reminders are recorded, failures included
--   G10 a payment officer sees none of it
-- ============================================================
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated, anon;

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-00000000ba01', 'gapadmin@test.com'),
  ('a0000000-0000-0000-0000-00000000ba02', 'gapofficer@test.com'),
  ('10000000-0000-0000-0000-00000000ba01', 'silent@test.com'),
  ('10000000-0000-0000-0000-00000000ba02', 'nobank@test.com'),
  ('10000000-0000-0000-0000-00000000ba03', 'paid@test.com'),
  ('10000000-0000-0000-0000-00000000ba04', 'rolled@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, email, full_name, role) VALUES
  ('a0000000-0000-0000-0000-00000000ba01', 'gapadmin@test.com', 'Gap Admin', 'super_admin'),
  ('a0000000-0000-0000-0000-00000000ba02', 'gapofficer@test.com', 'Gap Officer', 'payment_officer'),
  ('10000000-0000-0000-0000-00000000ba01', 'silent@test.com', 'Never Answered', 'investor'),
  ('10000000-0000-0000-0000-00000000ba02', 'nobank@test.com', 'No Bank', 'investor'),
  ('10000000-0000-0000-0000-00000000ba03', 'paid@test.com', 'Has Request', 'investor'),
  ('10000000-0000-0000-0000-00000000ba04', 'rolled@test.com', 'Rolled All', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- No Bank has answered but has NO account on record. That is the
-- silent failure this whole screen exists to surface.
INSERT INTO investors (id, profile_id, investor_code, full_name, email,
                       bank_name, account_name, account_number) VALUES
  ('20000000-0000-0000-0000-00000000ba01', '10000000-0000-0000-0000-00000000ba01',
   'MGG0001', 'Never Answered', 'silent@test.com', 'GTB', 'Never Answered', '0000000001'),
  ('20000000-0000-0000-0000-00000000ba02', '10000000-0000-0000-0000-00000000ba02',
   'MGG0002', 'No Bank', 'nobank@test.com', NULL, NULL, NULL),
  ('20000000-0000-0000-0000-00000000ba03', '10000000-0000-0000-0000-00000000ba03',
   'MGG0003', 'Has Request', 'paid@test.com', 'UBA', 'Has Request', '0000000003'),
  ('20000000-0000-0000-0000-00000000ba04', '10000000-0000-0000-0000-00000000ba04',
   'MGG0004', 'Rolled All', 'rolled@test.com', 'Zenith', 'Rolled All', '0000000004')
ON CONFLICT (id) DO NOTHING;

INSERT INTO series (id, name, description, start_month_offset, price_per_unit,
                    mudarabah_investor_ratio, default_wht_rate)
VALUES ('30000000-0000-0000-0000-00000000ba01', 'C', 'Series C', 0, 100000, 0.70, 0.10)
ON CONFLICT (name) DO UPDATE SET default_wht_rate = EXCLUDED.default_wht_rate;

-- Settled 20 days ago, so days_waiting has something to measure.
INSERT INTO cycles (id, series_id, cycle_number, cycle_label, start_date, end_date,
                    status, unit_value, wht_rate)
VALUES ('40000000-0000-0000-0000-00000000ba01', (SELECT id FROM series WHERE name='C'),
        7701, 'C-7701', CURRENT_DATE - 110, CURRENT_DATE - 20, 'active', 100000, 0.10);

INSERT INTO investments (id, investment_code, investor_id, series_id, cycle_id, units,
                         price_per_unit, capital, investment_date, maturity_date,
                         status, declared_profit, declared_wht, declared_profit_net) VALUES
  ('50000000-0000-0000-0000-00000000ba01', 'MGC-1', '20000000-0000-0000-0000-00000000ba01',
   (SELECT id FROM series WHERE name='C'), '40000000-0000-0000-0000-00000000ba01',
   10, 100000, 1000000, CURRENT_DATE-110, CURRENT_DATE-20, 'matured', 100000, 10000, 90000),
  ('50000000-0000-0000-0000-00000000ba02', 'MGC-2', '20000000-0000-0000-0000-00000000ba02',
   (SELECT id FROM series WHERE name='C'), '40000000-0000-0000-0000-00000000ba01',
   10, 100000, 1000000, CURRENT_DATE-110, CURRENT_DATE-20, 'matured', 100000, 10000, 90000),
  ('50000000-0000-0000-0000-00000000ba03', 'MGC-3', '20000000-0000-0000-0000-00000000ba03',
   (SELECT id FROM series WHERE name='C'), '40000000-0000-0000-0000-00000000ba01',
   10, 100000, 1000000, CURRENT_DATE-110, CURRENT_DATE-20, 'matured', 100000, 10000, 90000),
  ('50000000-0000-0000-0000-00000000ba04', 'MGC-4', '20000000-0000-0000-0000-00000000ba04',
   (SELECT id FROM series WHERE name='C'), '40000000-0000-0000-0000-00000000ba01',
   10, 100000, 1000000, CURRENT_DATE-110, CURRENT_DATE-20, 'matured', 100000, 10000, 90000);

INSERT INTO mudarabah_ledgers (id, cycle_id, description, disclose_mode, status)
VALUES ('80000000-0000-0000-0000-00000000ba01', '40000000-0000-0000-0000-00000000ba01',
        'home furniture', 'perSlot', 'settled');

INSERT INTO mudarabah_settlements
  (id, ledger_id, cycle_id, is_current, settled_at, engine_version,
   ratio_used, unit_value_used, wht_rate_used, computed, settled_by)
VALUES ('60000000-0000-0000-0000-00000000ba01', '80000000-0000-0000-0000-00000000ba01',
        '40000000-0000-0000-0000-00000000ba01', TRUE,
        NOW() - INTERVAL '20 days', 'test', 0.70, 100000, 0.10, '{}'::JSONB,
        'a0000000-0000-0000-0000-00000000ba01');

-- Has Request already has one raised.
INSERT INTO payment_requests (request_code, investor_id, investment_id, type, amount,
                              bank_name, account_name, account_number, status)
VALUES ('PR-G-0003', '20000000-0000-0000-0000-00000000ba03',
        '50000000-0000-0000-0000-00000000ba03', 'roi', 90000,
        'UBA', 'Has Request', '0000000003', 'pending');

-- No Bank answered; Rolled All took the legacy rollover_all.
INSERT INTO rollover_decisions
  (investment_id, investor_id, source_cycle_id, decision, submitted_at, deadline,
   decided_by, via, locked)
VALUES
  ('50000000-0000-0000-0000-00000000ba02', '20000000-0000-0000-0000-00000000ba02',
   '40000000-0000-0000-0000-00000000ba01',
   'exit', NOW() - INTERVAL '5 days', CURRENT_DATE + 5,
   '10000000-0000-0000-0000-00000000ba02', 'investor', TRUE),
  ('50000000-0000-0000-0000-00000000ba04', '20000000-0000-0000-0000-00000000ba04',
   '40000000-0000-0000-0000-00000000ba01',
   'rollover_all', NOW() - INTERVAL '5 days', CURRENT_DATE + 5,
   '10000000-0000-0000-0000-00000000ba04', 'investor', TRUE);

SET LOCAL test.uid = 'a0000000-0000-0000-0000-00000000ba01';

-- ------------------------------------------------------------
-- G1 / G2 / G3 / G5 — who is listed, and under which reason
-- ------------------------------------------------------------
DO $$ DECLARE r RECORD; v_n INT; BEGIN
  SELECT COUNT(*) INTO v_n FROM investors_awaiting_payment_request(NULL)
   WHERE investor_code IN ('MGG0001','MGG0002','MGG0003','MGG0004');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL G1: expected 3 of the 4 listed, got %', v_n;
  END IF;

  SELECT * INTO r FROM investors_awaiting_payment_request(NULL)
   WHERE investor_code = 'MGG0001';
  IF r.reason <> 'no_instruction' THEN
    RAISE EXCEPTION 'TEST FAIL G1: silent investor reported as %', r.reason;
  END IF;

  -- THE ONE THAT MATTERS. She answered, and sync_maturity_payment_
  -- requests returned {"skipped": "no bank details on record"} and
  -- raised nothing, silently. Before this screen nobody could see it.
  SELECT * INTO r FROM investors_awaiting_payment_request(NULL)
   WHERE investor_code = 'MGG0002';
  IF r.reason <> 'no_bank_details' THEN
    RAISE EXCEPTION 'TEST FAIL G2: the silent bank-details failure reads as %', r.reason;
  END IF;
  IF r.has_bank_details THEN
    RAISE EXCEPTION 'TEST FAIL G2: has_bank_details is true for an investor with none';
  END IF;
  -- An exit releases the capital too, and the screen has to say so.
  IF r.capital_available <> 1000000 THEN
    RAISE EXCEPTION 'TEST FAIL G2: capital available reads % on an exit', r.capital_available;
  END IF;

  -- G3. Somebody with a request is not somebody to chase.
  IF EXISTS (SELECT 1 FROM investors_awaiting_payment_request(NULL)
              WHERE investor_code = 'MGG0003') THEN
    RAISE EXCEPTION 'TEST FAIL G3: an investor with a request is on the chase list';
  END IF;

  -- G5. Listed so it is not mistaken for a fault, but owed nothing.
  SELECT * INTO r FROM investors_awaiting_payment_request(NULL)
   WHERE investor_code = 'MGG0004';
  IF r.reason <> 'nothing_payable' THEN
    RAISE EXCEPTION 'TEST FAIL G5: a rollover_all reads as %', r.reason;
  END IF;
  IF r.capital_available <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL G5: a rollover_all shows capital available';
  END IF;

  RAISE NOTICE 'PASS G1/G2/G3/G5: three reasons, told apart';
END $$;

-- ------------------------------------------------------------
-- G4 — a rejected request is not a request
-- ------------------------------------------------------------
DO $$ DECLARE v_n INT; BEGIN
  UPDATE payment_requests SET status = 'rejected' WHERE request_code = 'PR-G-0003';
  SELECT COUNT(*) INTO v_n FROM investors_awaiting_payment_request(NULL)
   WHERE investor_code = 'MGG0003';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL G4: a rejected request still hides the investor';
  END IF;
  UPDATE payment_requests SET status = 'pending' WHERE request_code = 'PR-G-0003';
  RAISE NOTICE 'PASS G4: a rejected request leaves them owed and visible';
END $$;

-- ------------------------------------------------------------
-- G6 / G7 — how long, and the card
-- ------------------------------------------------------------
DO $$ DECLARE r RECORD; v JSONB; BEGIN
  SELECT * INTO r FROM investors_awaiting_payment_request(NULL)
   WHERE investor_code = 'MGG0001';
  -- Measured from SETTLEMENT: the day the money became real, not the
  -- day the cycle was created.
  IF r.days_waiting <> 20 THEN
    RAISE EXCEPTION 'TEST FAIL G6: days waiting reads %, expected 20', r.days_waiting;
  END IF;

  v := payment_request_gap_counts(NULL);
  IF (v->>'awaiting')::INT <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL G7: awaiting counts %, expected 2 — %', v->>'awaiting', v::TEXT;
  END IF;
  IF (v->>'noInstruction')::INT <> 1 OR (v->>'noBankDetails')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL G7: the reasons are not split — %', v::TEXT;
  END IF;
  -- The one owed nothing must NOT inflate what is outstanding.
  IF (v->>'nothingPayable')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL G7: nothing_payable is not counted separately — %', v::TEXT;
  END IF;
  IF (v->>'over7')::INT <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL G7: over-7-days reads % — %', v->>'over7', v::TEXT;
  END IF;
  IF (v->>'over30')::INT <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL G7: over-30-days should be 0 at 20 days — %', v::TEXT;
  END IF;

  RAISE NOTICE 'PASS G6/G7: %', v::TEXT;
END $$;

-- ------------------------------------------------------------
-- G8 — recording the instruction is what clears them
--
--     Not creating a payment request directly. submit_rollover_
--     decision raises it from the settlement's frozen figures, which
--     is why there is no second path.
-- ------------------------------------------------------------
DO $$ DECLARE v_n INT; v_req INT; BEGIN
  PERFORM submit_rollover_decision(
    '50000000-0000-0000-0000-00000000ba01', 'continue'::maturity_decision,
    'GTB', 'Never Answered', '0000000001',
    'Recorded by Gap Admin on the investor''s behalf — Investor requested by WhatsApp',
    TRUE, NULL);

  SELECT COUNT(*) INTO v_req FROM payment_requests
   WHERE investment_id = '50000000-0000-0000-0000-00000000ba01';
  IF v_req < 1 THEN
    RAISE EXCEPTION 'TEST FAIL G8: recording the instruction raised no payment request';
  END IF;

  SELECT COUNT(*) INTO v_n FROM investors_awaiting_payment_request(NULL)
   WHERE investor_code = 'MGG0001';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL G8: still listed after the request was raised';
  END IF;

  -- And it is on the record as having been done for them.
  IF NOT EXISTS (
    SELECT 1 FROM rollover_decisions
     WHERE investment_id = '50000000-0000-0000-0000-00000000ba01'
       AND via = 'admin_exception'
       AND notes LIKE '%WhatsApp%'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL G8: the instruction does not record who or why';
  END IF;

  RAISE NOTICE 'PASS G8: the instruction raises the request and clears the list';
END $$;

-- ------------------------------------------------------------
-- G9 — reminders, failures included
-- ------------------------------------------------------------
DO $$ DECLARE r RECORD; v_n INT; BEGIN
  PERFORM record_payment_reminder(
    '50000000-0000-0000-0000-00000000ba02', 'nobank@test.com', 'sent', 'msg-1', NULL);
  -- A failure must be recorded too. A table that only holds successes
  -- reads as though nobody was ever missed.
  PERFORM record_payment_reminder(
    '50000000-0000-0000-0000-00000000ba02', 'nobank@test.com', 'failed', NULL, 'mailbox full');

  SELECT COUNT(*) INTO v_n FROM payment_reminder_history('50000000-0000-0000-0000-00000000ba02');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL G9: expected both attempts on record, got %', v_n;
  END IF;

  -- Only the successful one counts as having reached them.
  SELECT * INTO r FROM investors_awaiting_payment_request(NULL)
   WHERE investor_code = 'MGG0002';
  IF r.reminders_sent <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL G9: a failed reminder counted as sent (%)', r.reminders_sent;
  END IF;

  RAISE NOTICE 'PASS G9: both attempts recorded, only the delivered one counted';
END $$;

-- ------------------------------------------------------------
-- G10 — none of this is the Payment Officer's business
--
--     She works a queue of authorised payments. Investor contact
--     details and the means to record an instruction are not hers,
--     and is_admin() excludes her by design.
-- ------------------------------------------------------------
DO $$ DECLARE v_n INT; v JSONB; BEGIN
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000ba02', TRUE);

  SELECT COUNT(*) INTO v_n FROM investors_awaiting_payment_request(NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL G10: the payment officer can see % investors', v_n;
  END IF;

  v := payment_request_gap_counts(NULL);
  IF v <> '{}'::JSONB THEN
    RAISE EXCEPTION 'TEST FAIL G10: the officer gets counts — %', v::TEXT;
  END IF;

  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000ba01', TRUE);
  RAISE NOTICE 'PASS G10: the payment officer sees none of it';
END $$;

ROLLBACK;
\echo '=== ALL AWAITING PAYMENT TESTS PASSED ==='
