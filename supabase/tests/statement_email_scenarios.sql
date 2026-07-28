-- ============================================================
-- Emailing the cycle-end statement — migration 039
--
-- The documents have been built and stored since migration 022.
-- Nothing sent them. What matters most about adding sending is not
-- that it works but that it CANNOT HAPPEN TWICE: an investor who
-- receives two copies of a financial statement, with two different
-- covering notes, has every reason to doubt both.
--
--   E1  a fresh statement is waiting to be sent
--   E2  claiming it is what marks it sending
--   E3  A SECOND CLAIM GETS NOTHING — the double-send guard
--   E4  a document that was never built cannot be claimed
--   E5  once sent, it cannot be claimed again — not even on retry
--   E6  a failed one CAN be claimed again
--   E7  no email address is 'skipped', not 'failed'
--   E8  retry widens the set; a plain run does not
--   E9  a stuck send is released only when genuinely stale
--   E10 the counts tell the whole story, including no-address
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id,email) VALUES
 ('a0000000-0000-0000-0000-000000000e01','ea@t.com'),
 ('10000000-0000-0000-0000-000000000e01','e1@t.com'),
 ('10000000-0000-0000-0000-000000000e02','e2@t.com'),
 ('10000000-0000-0000-0000-000000000e03','e3@t.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id,email,full_name,role) VALUES
 ('a0000000-0000-0000-0000-000000000e01','ea@t.com','E Admin','super_admin'),
 ('10000000-0000-0000-0000-000000000e01','e1@t.com','E One','investor'),
 ('10000000-0000-0000-0000-000000000e02','e2@t.com','E Two','investor'),
 ('10000000-0000-0000-0000-000000000e03','e3@t.com','E Three','investor')
ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role;

-- E Three has an EMPTY email address. investors.email is NOT NULL, so
-- "no address" can never be a null in production — it is a blank or a
-- placeholder somebody typed to get past the form. The sender and the
-- counts both test for emptiness rather than nullness for exactly
-- that reason.
INSERT INTO investors (id,profile_id,investor_code,full_name,email,bank_name,account_name,account_number) VALUES
 ('20000000-0000-0000-0000-000000000e01','10000000-0000-0000-0000-000000000e01','MGE001','E One','e1@t.com','GTB','E One','0000000101'),
 ('20000000-0000-0000-0000-000000000e02','10000000-0000-0000-0000-000000000e02','MGE002','E Two','e2@t.com','GTB','E Two','0000000102'),
 ('20000000-0000-0000-0000-000000000e03','10000000-0000-0000-0000-000000000e03','MGE003','E Three','','GTB','E Three','0000000103')
ON CONFLICT (id) DO NOTHING;

INSERT INTO series (id,name,description,start_month_offset,price_per_unit,mudarabah_investor_ratio)
 VALUES ('30000000-0000-0000-0000-000000000e01','C','Series C',0,500000,0.85)
ON CONFLICT (name) DO UPDATE SET price_per_unit=EXCLUDED.price_per_unit;

INSERT INTO cycles (id,series_id,cycle_number,cycle_label,start_date,end_date,status,unit_value)
 VALUES ('40000000-0000-0000-0000-000000000e01',(SELECT id FROM series WHERE name='C'),
   9401,'E-9401', CURRENT_DATE - 90, CURRENT_DATE, 'completed', 500000);

INSERT INTO investments (id,investment_code,investor_id,series_id,cycle_id,units,price_per_unit,capital,
  investment_date,maturity_date,status,declared_profit,declared_wht,declared_profit_net) VALUES
 ('50000000-0000-0000-0000-000000000e01','E-1','20000000-0000-0000-0000-000000000e01',
  (SELECT id FROM series WHERE name='C'),'40000000-0000-0000-0000-000000000e01',
  2,500000,1000000,CURRENT_DATE-90,CURRENT_DATE,'matured',100000,10000,90000),
 ('50000000-0000-0000-0000-000000000e02','E-2','20000000-0000-0000-0000-000000000e02',
  (SELECT id FROM series WHERE name='C'),'40000000-0000-0000-0000-000000000e01',
  1,500000,500000,CURRENT_DATE-90,CURRENT_DATE,'matured',50000,5000,45000),
 ('50000000-0000-0000-0000-000000000e03','E-3','20000000-0000-0000-0000-000000000e03',
  (SELECT id FROM series WHERE name='C'),'40000000-0000-0000-0000-000000000e01',
  1,500000,500000,CURRENT_DATE-90,CURRENT_DATE,'matured',50000,5000,45000);

-- A settlement hangs off a ledger, so the cycle needs one.
INSERT INTO mudarabah_ledgers (id,cycle_id,description,disclose_mode,status)
VALUES ('80000000-0000-0000-0000-000000000e01','40000000-0000-0000-0000-000000000e01',
  'home furniture','perSlot','settled');

INSERT INTO mudarabah_settlements
  (id,ledger_id,cycle_id,is_current,settled_at,engine_version,
   ratio_used,unit_value_used,wht_rate_used,computed,settled_by)
VALUES ('60000000-0000-0000-0000-000000000e01','80000000-0000-0000-0000-000000000e01',
  '40000000-0000-0000-0000-000000000e01',TRUE,
  NOW(),'test',0.85,500000,0.10,'{}'::JSONB,'a0000000-0000-0000-0000-000000000e01');

-- Three documents. Two built, one that never rendered.
INSERT INTO mudarabah_statements
  (id,cycle_id,settlement_id,investment_id,investor_id,kind,storage_path,state,bytes,generated_at) VALUES
 ('70000000-0000-0000-0000-000000000e01','40000000-0000-0000-0000-000000000e01',
  '60000000-0000-0000-0000-000000000e01','50000000-0000-0000-0000-000000000e01',
  '20000000-0000-0000-0000-000000000e01','statement','p/e1.pdf','ready',1000,NOW()),
 ('70000000-0000-0000-0000-000000000e02','40000000-0000-0000-0000-000000000e01',
  '60000000-0000-0000-0000-000000000e01','50000000-0000-0000-0000-000000000e02',
  '20000000-0000-0000-0000-000000000e02','statement',NULL,'failed',NULL,NULL),
 ('70000000-0000-0000-0000-000000000e03','40000000-0000-0000-0000-000000000e01',
  '60000000-0000-0000-0000-000000000e01','50000000-0000-0000-0000-000000000e03',
  '20000000-0000-0000-0000-000000000e03','statement','p/e3.pdf','ready',1000,NOW());

-- A fourth: a STALE file from an earlier successful build, whose
-- latest regeneration failed. storage_path still points at something,
-- so the "is there a file" guard would wave it through — but the file
-- is out of date and emailing it would send figures the portal no
-- longer shows. This is why the claim checks the STATE as well.
INSERT INTO investments (id,investment_code,investor_id,series_id,cycle_id,units,price_per_unit,capital,
  investment_date,maturity_date,status,declared_profit,declared_wht,declared_profit_net)
VALUES ('50000000-0000-0000-0000-000000000e04','E-4','20000000-0000-0000-0000-000000000e01',
  (SELECT id FROM series WHERE name='C'),'40000000-0000-0000-0000-000000000e01',
  1,500000,500000,CURRENT_DATE-90,CURRENT_DATE,'matured',50000,5000,45000);

INSERT INTO mudarabah_statements
  (id,cycle_id,settlement_id,investment_id,investor_id,kind,storage_path,state,bytes,generated_at)
VALUES ('70000000-0000-0000-0000-000000000e04','40000000-0000-0000-0000-000000000e01',
  '60000000-0000-0000-0000-000000000e01','50000000-0000-0000-0000-000000000e04',
  '20000000-0000-0000-0000-000000000e01','statement','p/e4-stale.pdf','failed',900,NOW());

SELECT set_config('test.uid','a0000000-0000-0000-0000-000000000e01',false);

-- ------------------------------------------------------------
-- E1 / E4 — only BUILT documents are waiting to be sent
-- ------------------------------------------------------------
DO $$ DECLARE v_n INT; BEGIN
  SELECT COUNT(*) INTO v_n FROM mudarabah_statements_to_email('40000000-0000-0000-0000-000000000e01');
  -- E One and E Three. E Two's document was never built, so there is
  -- nothing to attach and it must not appear.
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL E1: % statements queued to send, expected 2', v_n;
  END IF;
  IF EXISTS (
    SELECT 1 FROM mudarabah_statements_to_email('40000000-0000-0000-0000-000000000e01')
     WHERE statement_id = '70000000-0000-0000-0000-000000000e04'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL E1: a stale document is queued for sending';
  END IF;
  IF EXISTS (
    SELECT 1 FROM mudarabah_statements_to_email('40000000-0000-0000-0000-000000000e01')
     WHERE investor_code = 'MGE002'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL E4: a statement with no document is queued for sending';
  END IF;
  RAISE NOTICE 'PASS E1/E4 — 2 waiting; the unbuilt one is not among them';
END $$;

-- ------------------------------------------------------------
-- E4b — and the CLAIM refuses it too, not just the queue.
--
--      Two guards for one rule, deliberately. The queue is what the
--      sender walks; the claim is what actually writes. If only the
--      queue checked, any future caller that skipped it — a retry
--      loop, a script, a fix applied by hand — could send "your
--      statement is attached" with nothing attached.
-- ------------------------------------------------------------
DO $$ DECLARE v_ok BOOLEAN; BEGIN
  v_ok := mudarabah_claim_statement_email('70000000-0000-0000-0000-000000000e02','e2@t.com');
  IF v_ok THEN
    RAISE EXCEPTION 'TEST FAIL E4b: claimed a statement whose document was never built';
  END IF;
  IF (SELECT email_state FROM mudarabah_statements
       WHERE id='70000000-0000-0000-0000-000000000e02') <> 'unsent' THEN
    RAISE EXCEPTION 'TEST FAIL E4b: the refused claim still moved the row';
  END IF;
  -- The stale case: a file IS there, but it is not the current one.
  v_ok := mudarabah_claim_statement_email('70000000-0000-0000-0000-000000000e04','e1@t.com');
  IF v_ok THEN
    RAISE EXCEPTION 'TEST FAIL E4b: claimed a stale document whose rebuild had failed';
  END IF;

  RAISE NOTICE 'PASS E4b — neither a missing document nor a stale one can be claimed';
END $$;

-- ------------------------------------------------------------
-- E2 / E3 — THE DOUBLE-SEND GUARD
-- ------------------------------------------------------------
DO $$ DECLARE v_first BOOLEAN; v_second BOOLEAN; v_state TEXT; v_att INT; BEGIN
  v_first  := mudarabah_claim_statement_email('70000000-0000-0000-0000-000000000e01','e1@t.com');
  v_second := mudarabah_claim_statement_email('70000000-0000-0000-0000-000000000e01','e1@t.com');

  IF NOT v_first THEN
    RAISE EXCEPTION 'TEST FAIL E2: the first claim was refused';
  END IF;
  IF v_second THEN
    RAISE EXCEPTION 'TEST FAIL E3: a SECOND claim succeeded — this investor would be emailed twice';
  END IF;

  SELECT email_state, email_attempts INTO v_state, v_att
    FROM mudarabah_statements WHERE id = '70000000-0000-0000-0000-000000000e01';
  IF v_state <> 'sending' THEN
    RAISE EXCEPTION 'TEST FAIL E2: state is %, expected sending', v_state;
  END IF;
  -- The refused claim must not have counted as an attempt either.
  IF v_att <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL E3: % attempts recorded, expected 1', v_att;
  END IF;
  RAISE NOTICE 'PASS E2/E3 — claimed once, refused the second time';
END $$;

-- ------------------------------------------------------------
-- E5 — and once SENT it can never be claimed again
-- ------------------------------------------------------------
DO $$ DECLARE v_ok BOOLEAN; v_n INT; BEGIN
  PERFORM mudarabah_mark_statement_email(
    '70000000-0000-0000-0000-000000000e01','sent','msg-1',NULL);

  IF (SELECT emailed_at FROM mudarabah_statements
       WHERE id='70000000-0000-0000-0000-000000000e01') IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL E5: sending was not timestamped';
  END IF;

  v_ok := mudarabah_claim_statement_email('70000000-0000-0000-0000-000000000e01','e1@t.com');
  IF v_ok THEN
    RAISE EXCEPTION 'TEST FAIL E5: a statement already sent was claimed again';
  END IF;

  -- Not even a retry run may include it.
  SELECT COUNT(*) INTO v_n FROM mudarabah_statements_to_email(
    '40000000-0000-0000-0000-000000000e01', TRUE)
   WHERE statement_id = '70000000-0000-0000-0000-000000000e01';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL E5: a retry would re-send an already-sent statement';
  END IF;
  RAISE NOTICE 'PASS E5 — sent is final, retry included';
END $$;

-- ------------------------------------------------------------
-- E6 / E7 / E8 — failed retries, no-address skips, and the
--                difference between a plain run and a retry
-- ------------------------------------------------------------
DO $$ DECLARE v_ok BOOLEAN; v_plain INT; v_retry INT; BEGIN
  -- E Three has no address: the sender records that as skipped.
  PERFORM mudarabah_mark_statement_email(
    '70000000-0000-0000-0000-000000000e03','skipped',NULL,
    'No email address on record for this investor');

  -- A plain run now has nothing to do…
  SELECT COUNT(*) INTO v_plain FROM mudarabah_statements_to_email(
    '40000000-0000-0000-0000-000000000e01', FALSE);
  IF v_plain <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL E8: a plain run still has % to send', v_plain;
  END IF;

  -- …while a retry picks the skipped one back up, in case the
  -- address has since been added.
  SELECT COUNT(*) INTO v_retry FROM mudarabah_statements_to_email(
    '40000000-0000-0000-0000-000000000e01', TRUE);
  IF v_retry <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL E8: a retry offers %, expected 1', v_retry;
  END IF;

  -- E6: and a genuinely failed one is claimable again.
  PERFORM mudarabah_mark_statement_email(
    '70000000-0000-0000-0000-000000000e03','failed',NULL,'Mailbox full');
  v_ok := mudarabah_claim_statement_email('70000000-0000-0000-0000-000000000e03','e3@t.com');
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAIL E6: a failed statement could not be retried';
  END IF;
  RAISE NOTICE 'PASS E6/E7/E8 — skipped is not failed, and retry means retry';
END $$;

-- ------------------------------------------------------------
-- E9 — a stuck send is released only when genuinely stale
-- ------------------------------------------------------------
DO $$ DECLARE v_n INT; BEGIN
  -- 70…e03 is 'sending' right now, and was claimed a moment ago.
  v_n := mudarabah_release_stuck_statement_emails(
    '40000000-0000-0000-0000-000000000e01', INTERVAL '15 minutes');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL E9: released % send(s) that had only just started', v_n;
  END IF;

  -- Age it, and it is fair game.
  UPDATE mudarabah_statements SET updated_at = NOW() - INTERVAL '1 hour'
   WHERE id = '70000000-0000-0000-0000-000000000e03';

  v_n := mudarabah_release_stuck_statement_emails(
    '40000000-0000-0000-0000-000000000e01', INTERVAL '15 minutes');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL E9: released %, expected the one abandoned send', v_n;
  END IF;
  IF (SELECT email_error FROM mudarabah_statements
       WHERE id='70000000-0000-0000-0000-000000000e03') NOT LIKE '%interrupted%' THEN
    RAISE EXCEPTION 'TEST FAIL E9: the release did not say what happened';
  END IF;
  RAISE NOTICE 'PASS E9 — a fresh send is left alone, an abandoned one is released';
END $$;

-- ------------------------------------------------------------
-- E10 — the counts, including the case retrying cannot fix
-- ------------------------------------------------------------
DO $$ DECLARE v JSONB; BEGIN
  v := mudarabah_statement_email_counts('40000000-0000-0000-0000-000000000e01');

  IF (v->>'documents')::INT <> 4 THEN
    RAISE EXCEPTION 'TEST FAIL E10: % documents counted, expected 4', v->>'documents';
  END IF;
  IF (v->>'notBuilt')::INT <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL E10: the unbuilt document is not reported — %', v::TEXT;
  END IF;
  IF (v->>'sent')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL E10: % sent, expected 1', v->>'sent';
  END IF;
  -- The one that can never be fixed by pressing retry.
  IF (v->>'noEmailAddress')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL E10: the investor with no address is invisible — %', v::TEXT;
  END IF;
  RAISE NOTICE 'PASS E10 — %', v::TEXT;
END $$;

-- ------------------------------------------------------------
-- E11 — and none of this is reachable by an investor
-- ------------------------------------------------------------
SELECT set_config('test.uid','10000000-0000-0000-0000-000000000e01',false);

DO $$ DECLARE v_msg TEXT; BEGIN
  BEGIN
    PERFORM mudarabah_claim_statement_email('70000000-0000-0000-0000-000000000e02','x@t.com');
    RAISE EXCEPTION 'TEST FAIL E11: an investor claimed a statement for sending';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;
  IF v_msg <> 'Unauthorized' THEN
    RAISE EXCEPTION 'TEST FAIL E11: refused for the wrong reason — %', v_msg;
  END IF;
  RAISE NOTICE 'PASS E11 — %', v_msg;
END $$;

-- ============================================================
-- Migration 041 — the server can record what it has done
--
-- THE FAULT THIS FIXES. Building a cycle's statements ran for
-- minutes and saved nothing: thirty-eight documents rendered,
-- thirty-eight files uploaded, and thirty-eight rows still reading
-- "Queued", attempt count zero. The renderer runs under the
-- SERVICE-ROLE key because it has to write to a private bucket, and
-- a service-role connection is not a logged-in person — auth.uid()
-- is NULL and there is no profiles row for it. The admin gate looked
-- that row up, found nothing, and refused every call.
--
-- The gate never protected anything against that caller: row-level
-- security does not apply to the service role, so it could already
-- write these tables directly. What it must still refuse is
-- everybody else, and E13–E15 are the ones that matter.
--
--   E12 the server marks a document ready — the regression
--   E13 an investor still cannot
--   E14 nor can finance, which is admin for READING but not this
--   E15 an administrator still can, exactly as before
-- ============================================================

-- ------------------------------------------------------------
-- E12 — the server, holding the service-role key
-- ------------------------------------------------------------
SELECT set_config('test.uid','',false);
SELECT set_config('test.role','service_role',false);

DO $$ DECLARE v_state TEXT; v_attempts INT; BEGIN
  PERFORM mudarabah_mark_statement(
    '70000000-0000-0000-0000-000000000e02', 'ready', 'p/e2.pdf', 4096, NULL);

  SELECT state, attempts INTO v_state, v_attempts
  FROM mudarabah_statements WHERE id = '70000000-0000-0000-0000-000000000e02';

  IF v_state <> 'ready' THEN
    RAISE EXCEPTION 'TEST FAIL E12: the document was built but the row still reads % — this is the bug', v_state;
  END IF;
  IF v_attempts < 1 THEN
    RAISE EXCEPTION 'TEST FAIL E12: the attempt was not counted';
  END IF;
  RAISE NOTICE 'PASS E12 — the server recorded the document (%, % attempt(s))', v_state, v_attempts;
END $$;

-- ------------------------------------------------------------
-- E13 — an investor cannot, service role or no service role
-- ------------------------------------------------------------
SELECT set_config('test.role','authenticated',false);
SELECT set_config('test.uid','10000000-0000-0000-0000-000000000e01',false);

DO $$ DECLARE v_msg TEXT; BEGIN
  BEGIN
    PERFORM mudarabah_mark_statement(
      '70000000-0000-0000-0000-000000000e01', 'failed', NULL, NULL, 'tampered');
    RAISE EXCEPTION 'TEST FAIL E13: an investor rewrote a statement record';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;
  IF v_msg NOT LIKE '%administrator%' THEN
    RAISE EXCEPTION 'TEST FAIL E13: refused for the wrong reason — %', v_msg;
  END IF;
  RAISE NOTICE 'PASS E13 — %', v_msg;
END $$;

-- ------------------------------------------------------------
-- E14 — nor can finance
--
--     is_admin() includes finance; mudarabah_assert_admin() never
--     did, and widening for the server must not have widened it for
--     a person.
-- ------------------------------------------------------------
INSERT INTO auth.users (id,email) VALUES
 ('a0000000-0000-0000-0000-000000000e02','ef@t.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id,email,full_name,role) VALUES
 ('a0000000-0000-0000-0000-000000000e02','ef@t.com','E Finance','finance')
ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role;

SELECT set_config('test.uid','a0000000-0000-0000-0000-000000000e02',false);

DO $$ DECLARE v_msg TEXT; BEGIN
  BEGIN
    PERFORM mudarabah_mark_statement(
      '70000000-0000-0000-0000-000000000e01', 'failed', NULL, NULL, 'tampered');
    RAISE EXCEPTION 'TEST FAIL E14: finance rewrote a statement record';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;
  IF v_msg NOT LIKE '%administrator%' THEN
    RAISE EXCEPTION 'TEST FAIL E14: refused for the wrong reason — %', v_msg;
  END IF;
  RAISE NOTICE 'PASS E14 — %', v_msg;
END $$;

-- ------------------------------------------------------------
-- E15 — and an administrator is unaffected
-- ------------------------------------------------------------
SELECT set_config('test.uid','a0000000-0000-0000-0000-000000000e01',false);

DO $$ DECLARE v_state TEXT; BEGIN
  PERFORM mudarabah_mark_statement(
    '70000000-0000-0000-0000-000000000e03', 'failed', NULL, NULL, 'render timed out');
  SELECT state INTO v_state FROM mudarabah_statements
   WHERE id = '70000000-0000-0000-0000-000000000e03';
  IF v_state <> 'failed' THEN
    RAISE EXCEPTION 'TEST FAIL E15: an administrator could no longer record an outcome (%)', v_state;
  END IF;
  RAISE NOTICE 'PASS E15 — an administrator still records outcomes';
END $$;

SELECT set_config('test.role','authenticated',false);

ROLLBACK;
