-- ============================================================
-- Cycle length — migration 064
--
-- The length of a cycle is a setting on the series (6 months) and is
-- recorded on each cycle. The 049 same-day anchored dates still hold.
-- Fixed dates throughout. Everything ROLLS BACK.
--
--   L1  at 3 months the new end-date rule is 049's, for every start
--       day of 2026–2028 and every anchor day 1–31
--   L2  a 6-month series: 30 May 2026 → 30 Nov 2026 → 30 May 2027
--   L3  the 31st clamps once and recovers: 31 Dec 2026 → 30 Jun 2027
--       → 31 Dec 2027
--   L4  a generated cycle records its length, number, label, status
--   L5  a cycle inserted without a length takes its series' length;
--       changing the series later never moves an existing cycle
--   L6  the ledger holds as many months as its cycle: month 6 on a
--       6-month cycle, never month 7; never month 4 on a 3-month cycle
--   L7  the ledger reader says how many months the cycle runs
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION _chain6(p_series series_name, p_n INT) RETURNS TEXT[] AS $$
DECLARE v_out TEXT[] := '{}'; v_id UUID; v_c cycles%ROWTYPE; i INT;
BEGIN
  FOR i IN 1..p_n LOOP
    v_id := create_next_cycle((SELECT id FROM series WHERE name = p_series));
    SELECT * INTO v_c FROM cycles WHERE id = v_id;
    v_out := v_out || (TO_CHAR(v_c.start_date, 'YYYY-MM-DD') || '→' || TO_CHAR(v_c.end_date, 'YYYY-MM-DD'));
  END LOOP;
  RETURN v_out;
END $$ LANGUAGE plpgsql;

UPDATE series SET cycle_months = 6;
INSERT INTO cycles (id, series_id, cycle_number, cycle_label, start_date, end_date, status, cycle_months) VALUES
 ('60000000-0000-0000-0000-0000000ea001', (SELECT id FROM series WHERE name='A'),
  9901, 'Feb 2026 – May 2026', '2026-02-28', '2026-05-30', 'completed', 3),
 ('60000000-0000-0000-0000-0000000eb001', (SELECT id FROM series WHERE name='B'),
  9901, 'Sep 2026 – Dec 2026', '2026-09-30', '2026-12-31', 'completed', 3);

-- L1 — the 049 rule, verbatim, against the new helper at 3 months
DO $$
DECLARE d DATE; a INT; v_intended INT; v_month DATE; v_len INT; v_049 DATE; v_bad INT := 0;
BEGIN
  FOR d IN SELECT generate_series('2026-01-01'::DATE, '2028-12-31'::DATE, '1 day')::DATE LOOP
    FOR a IN EXTRACT(DAY FROM d)::INT .. 31 LOOP
      IF d = (DATE_TRUNC('month', d) + INTERVAL '1 month' - INTERVAL '1 day')::DATE THEN v_intended := a;
      ELSE v_intended := EXTRACT(DAY FROM d)::INT; END IF;
      v_month := (DATE_TRUNC('month', d) + INTERVAL '3 months')::DATE;
      v_len := EXTRACT(DAY FROM (v_month + INTERVAL '1 month' - INTERVAL '1 day'))::INT;
      v_049 := v_month + (LEAST(v_intended, v_len) - 1);
      IF maalgrow_cycle_end(d, 3, a) <> v_049 THEN v_bad := v_bad + 1; END IF;
    END LOOP;
  END LOOP;
  IF v_bad > 0 THEN RAISE EXCEPTION 'TEST FAIL L1: % start/anchor pairs differ from 049', v_bad; END IF;
  RAISE NOTICE 'PASS L1 — at 3 months the end date is 049''s for every start day 2026–2028 and anchor';
END $$;

-- L2 — six months, on the same day
DO $$ DECLARE v TEXT[]; BEGIN
  v := _chain6('A', 2);
  IF v <> ARRAY['2026-05-30→2026-11-30', '2026-11-30→2027-05-30'] THEN
    RAISE EXCEPTION 'TEST FAIL L2: got %', v; END IF;
  RAISE NOTICE 'PASS L2 — %', array_to_string(v, ', ');
END $$;

-- L3 — the 31st clamps to 30 June once, then comes back
DO $$ DECLARE v TEXT[]; BEGIN
  v := _chain6('B', 2);
  IF v <> ARRAY['2026-12-31→2027-06-30', '2027-06-30→2027-12-31'] THEN
    RAISE EXCEPTION 'TEST FAIL L3: got %', v; END IF;
  RAISE NOTICE 'PASS L3 — %', array_to_string(v, ', ');
END $$;

-- L4 — what a generated cycle records
DO $$ DECLARE c cycles%ROWTYPE; BEGIN
  SELECT * INTO c FROM cycles WHERE series_id = (SELECT id FROM series WHERE name='A') ORDER BY cycle_number DESC LIMIT 1;
  IF c.cycle_months <> 6 OR c.cycle_number <> 9903 OR c.status <> 'upcoming' OR c.cycle_label <> 'Nov 2026 – May 2027' THEN
    RAISE EXCEPTION 'TEST FAIL L4: % / % / % / %', c.cycle_months, c.cycle_number, c.status, c.cycle_label; END IF;
  RAISE NOTICE 'PASS L4 — 6 months, number 9903, upcoming, "%"', c.cycle_label;
END $$;

-- L5 — a length is taken from the series when none is given, and kept
DO $$ DECLARE v_id UUID; v_end DATE; BEGIN
  INSERT INTO cycles (series_id, cycle_number, cycle_label, start_date, end_date, status)
  VALUES ((SELECT id FROM series WHERE name='C'), 9950, 'Jan 2030 – Jul 2030', '2030-01-15', '2030-07-15', 'upcoming')
  RETURNING id INTO v_id;
  IF (SELECT cycle_months FROM cycles WHERE id = v_id) <> 6 THEN RAISE EXCEPTION 'TEST FAIL L5: no length from the series'; END IF;
  SELECT end_date INTO v_end FROM cycles WHERE id = '60000000-0000-0000-0000-0000000ea001';
  UPDATE series SET cycle_months = 4 WHERE name = 'A';
  IF (SELECT end_date || ':' || cycle_months FROM cycles WHERE id = '60000000-0000-0000-0000-0000000ea001') <> v_end || ':3' THEN
    RAISE EXCEPTION 'TEST FAIL L5: changing the series moved an existing cycle'; END IF;
  UPDATE series SET cycle_months = 6 WHERE name = 'A';
  RAISE NOTICE 'PASS L5 — a new cycle takes the series length; an existing one never moves';
END $$;

-- L6 — the ledger and its months
CREATE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END;
$$ LANGUAGE plpgsql;
DO $$ DECLARE l6 UUID; l3 UUID; c6 UUID; e TEXT; BEGIN
  SELECT id INTO c6 FROM cycles WHERE series_id = (SELECT id FROM series WHERE name='A') AND cycle_months = 6 ORDER BY cycle_number LIMIT 1;
  INSERT INTO mudarabah_ledgers (cycle_id) VALUES (c6) RETURNING id INTO l6;
  INSERT INTO mudarabah_ledgers (cycle_id) VALUES ('60000000-0000-0000-0000-0000000ea001') RETURNING id INTO l3;
  INSERT INTO mudarabah_months (ledger_id, month_index) SELECT l6, g FROM generate_series(1, 6) g;
  e := pg_temp.err(format('INSERT INTO mudarabah_months (ledger_id, month_index) VALUES (%L, 7)', l6));
  IF e IS NULL OR e NOT LIKE '%runs 6 months; there is no month 7%' THEN RAISE EXCEPTION 'TEST FAIL L6: month 7 accepted (%)', e; END IF;
  INSERT INTO mudarabah_months (ledger_id, month_index) SELECT l3, g FROM generate_series(1, 3) g;
  e := pg_temp.err(format('INSERT INTO mudarabah_months (ledger_id, month_index) VALUES (%L, 4)', l3));
  IF e IS NULL OR e NOT LIKE '%runs 3 months; there is no month 4%' THEN RAISE EXCEPTION 'TEST FAIL L6: month 4 accepted on a 3-month cycle (%)', e; END IF;
  -- L7
  IF (mudarabah_get_ledger(c6)->>'cycleMonths')::INT <> 6
     OR (mudarabah_get_ledger('60000000-0000-0000-0000-0000000ea001')->>'cycleMonths')::INT <> 3
     OR jsonb_array_length(mudarabah_get_ledger(c6)->'months') <> 6 THEN
    RAISE EXCEPTION 'TEST FAIL L7: the ledger reader does not report the cycle length'; END IF;
  RAISE NOTICE 'PASS L6 — six months on a 6-month cycle, never seven; never four on a 3-month cycle';
  RAISE NOTICE 'PASS L7 — the ledger reader reports cycleMonths 6 and 3';
END $$;

ROLLBACK;
