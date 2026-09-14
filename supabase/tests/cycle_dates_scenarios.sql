-- ============================================================
-- Cycle dates — migration 049
--
-- create_next_cycle() dates a generated cycle from the same day its
-- predecessor ends, three calendar months on, anchored to the
-- series' day of month so a February clamp does not become
-- permanent. Fixed dates throughout, so every expectation is a
-- literal that can be checked against a calendar.
--
--   D1  same-day start: 30 Aug 2026 ends, 30 Aug 2026 begins, 30 Nov ends
--   D2  February clamps once: 30 Nov 2026 → 28 Feb 2027
--   D3  and the 30th comes back: 28 Feb 2027 → 30 May 2027
--   D4  seven chained cycles, through a leap February, no drift
--   D5  a series on the 31st recovers after two consecutive clamps
--   D6  a series on the 1st is never moved
--   D7  generating a cycle changes no existing cycle's dates
--   D8  the same-day successor still resolves, and is not duplicated
--   D9  number, label and status of a generated cycle
--   D10 a 036-era day-after cycle coexists and is continued from its end
--   D11 a cancelled cycle does not set the anchor
--   D12 a mid-month start is continued on its own day, not the anchor
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

-- Chain p_n generated cycles onto a series and return them as
-- 'start→end' strings, so a whole run is one comparison.
CREATE FUNCTION _chain(p_series series_name, p_n INT) RETURNS TEXT[] AS $$
DECLARE v_out TEXT[] := '{}'; v_id UUID; v_c cycles%ROWTYPE; i INT;
BEGIN
  FOR i IN 1..p_n LOOP
    v_id := create_next_cycle((SELECT id FROM series WHERE name = p_series));
    SELECT * INTO v_c FROM cycles WHERE id = v_id;
    v_out := v_out || (TO_CHAR(v_c.start_date, 'YYYY-MM-DD') || '→' || TO_CHAR(v_c.end_date, 'YYYY-MM-DD'));
  END LOOP;
  RETURN v_out;
END $$ LANGUAGE plpgsql;

-- Three roots, one per series, each created by hand under the
-- administrators' own convention.
INSERT INTO cycles (id, series_id, cycle_number, cycle_label, start_date, end_date, status) VALUES
 ('60000000-0000-0000-0000-0000000da001', (SELECT id FROM series WHERE name='A'),
  8801, 'May 2026 – Aug 2026', '2026-05-30', '2026-08-30', 'completed'),
 ('60000000-0000-0000-0000-0000000db001', (SELECT id FROM series WHERE name='B'),
  8801, 'Dec 2026 – Mar 2027', '2026-12-31', '2027-03-31', 'completed'),
 ('60000000-0000-0000-0000-0000000dc001', (SELECT id FROM series WHERE name='C'),
  8801, 'Oct 2026 – Jan 2027', '2026-10-01', '2027-01-01', 'completed');

-- ------------------------------------------------------------
-- D1 — the same day, three months on
-- ------------------------------------------------------------
DO $$ DECLARE v TEXT[]; BEGIN
  v := _chain('A', 1);
  IF v <> ARRAY['2026-08-30→2026-11-30'] THEN
    RAISE EXCEPTION 'TEST FAIL D1: got %, expected 30 Aug 2026 → 30 Nov 2026', v;
  END IF;
  RAISE NOTICE 'PASS D1 — %', v[1];
END $$;

-- ------------------------------------------------------------
-- D2 — February clamps, because it has to
-- ------------------------------------------------------------
DO $$ DECLARE v TEXT[]; BEGIN
  v := _chain('A', 1);
  IF v <> ARRAY['2026-11-30→2027-02-28'] THEN
    RAISE EXCEPTION 'TEST FAIL D2: got %, expected 30 Nov 2026 → 28 Feb 2027', v;
  END IF;
  RAISE NOTICE 'PASS D2 — %', v[1];
END $$;

-- ------------------------------------------------------------
-- D3 — and the 30th comes back. Under 036 this was 28 May.
-- ------------------------------------------------------------
DO $$ DECLARE v TEXT[]; BEGIN
  v := _chain('A', 1);
  IF v <> ARRAY['2027-02-28→2027-05-30'] THEN
    RAISE EXCEPTION 'TEST FAIL D3: got %, expected 28 Feb 2027 → 30 May 2027', v;
  END IF;
  RAISE NOTICE 'PASS D3 — %', v[1];
END $$;

-- ------------------------------------------------------------
-- D4 — four more, through a leap-year February. No drift.
-- ------------------------------------------------------------
DO $$ DECLARE v TEXT[]; BEGIN
  v := _chain('A', 4);
  IF v <> ARRAY['2027-05-30→2027-08-30',
                '2027-08-30→2027-11-30',
                '2027-11-30→2028-02-29',
                '2028-02-29→2028-05-30'] THEN
    RAISE EXCEPTION 'TEST FAIL D4: got %', v;
  END IF;
  RAISE NOTICE 'PASS D4 — seven cycles from 30 Aug 2026, still on the 30th in May 2028';
END $$;

-- ------------------------------------------------------------
-- D5 — a series on the 31st: 30 Jun and 30 Sep are both clamped,
--      one after the other, and 31 Dec still arrives.
-- ------------------------------------------------------------
DO $$ DECLARE v TEXT[]; BEGIN
  v := _chain('B', 4);
  IF v <> ARRAY['2027-03-31→2027-06-30',
                '2027-06-30→2027-09-30',
                '2027-09-30→2027-12-31',
                '2027-12-31→2028-03-31'] THEN
    RAISE EXCEPTION 'TEST FAIL D5: got %', v;
  END IF;
  RAISE NOTICE 'PASS D5 — 31st recovers after two consecutive clamps';
END $$;

-- ------------------------------------------------------------
-- D6 — a series on the 1st is never pushed to a month end
-- ------------------------------------------------------------
DO $$ DECLARE v TEXT[]; BEGIN
  v := _chain('C', 4);
  IF v <> ARRAY['2027-01-01→2027-04-01',
                '2027-04-01→2027-07-01',
                '2027-07-01→2027-10-01',
                '2027-10-01→2028-01-01'] THEN
    RAISE EXCEPTION 'TEST FAIL D6: got %', v;
  END IF;
  RAISE NOTICE 'PASS D6 — 1st stays the 1st';
END $$;

-- ------------------------------------------------------------
-- D7 — generating a cycle rewrites nothing that already exists
-- ------------------------------------------------------------
CREATE TEMP TABLE _before AS SELECT id, start_date, end_date, cycle_label, status FROM cycles;
DO $$ DECLARE v_id UUID; v_changed INT; v_n INT; BEGIN
  v_id := create_next_cycle((SELECT id FROM series WHERE name='A'));
  SELECT COUNT(*) INTO v_changed
  FROM _before b JOIN cycles c ON c.id = b.id
  WHERE c.start_date IS DISTINCT FROM b.start_date
     OR c.end_date   IS DISTINCT FROM b.end_date
     OR c.cycle_label IS DISTINCT FROM b.cycle_label
     OR c.status     IS DISTINCT FROM b.status;
  SELECT COUNT(*) INTO v_n FROM _before b WHERE NOT EXISTS (SELECT 1 FROM cycles c WHERE c.id = b.id);
  IF v_changed <> 0 OR v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL D7: % existing cycles changed, % missing', v_changed, v_n;
  END IF;
  RAISE NOTICE 'PASS D7 — % existing cycles untouched', (SELECT COUNT(*) FROM _before);
END $$;

-- ------------------------------------------------------------
-- D8 — the same-day successor resolves through mudarabah_next_cycle
--      (start_date >= end_date), and ensure finds it rather than
--      making another.
-- ------------------------------------------------------------
DO $$ DECLARE v_next UUID; v_ensured UUID; v_n INT; v_m INT; BEGIN
  v_next := mudarabah_next_cycle('60000000-0000-0000-0000-0000000da001');
  IF v_next IS NULL OR (SELECT start_date FROM cycles WHERE id = v_next) <> DATE '2026-08-30' THEN
    RAISE EXCEPTION 'TEST FAIL D8: successor of the 30 Aug root not resolved (got %)', v_next;
  END IF;
  SELECT COUNT(*) INTO v_n FROM cycles WHERE series_id = (SELECT id FROM series WHERE name='A');
  v_ensured := mudarabah_ensure_next_cycle('60000000-0000-0000-0000-0000000da001');
  SELECT COUNT(*) INTO v_m FROM cycles WHERE series_id = (SELECT id FROM series WHERE name='A');
  IF v_ensured <> v_next OR v_m <> v_n THEN
    RAISE EXCEPTION 'TEST FAIL D8: ensure returned % (expected %), count % → %', v_ensured, v_next, v_n, v_m;
  END IF;
  RAISE NOTICE 'PASS D8 — same-day successor resolves and is not duplicated';
END $$;

-- ------------------------------------------------------------
-- D9 — the generated row: next number, label from its dates, upcoming
-- ------------------------------------------------------------
DO $$ DECLARE v cycles%ROWTYPE; BEGIN
  SELECT * INTO v FROM cycles
  WHERE series_id = (SELECT id FROM series WHERE name='A') AND cycle_number = 8802;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEST FAIL D9: cycle 8802 not found'; END IF;
  IF v.cycle_label <> 'Aug 2026 – Nov 2026' THEN
    RAISE EXCEPTION 'TEST FAIL D9: label "%", expected "Aug 2026 – Nov 2026"', v.cycle_label;
  END IF;
  IF v.status <> 'upcoming' THEN
    RAISE EXCEPTION 'TEST FAIL D9: status %, expected upcoming', v.status;
  END IF;
  RAISE NOTICE 'PASS D9 — #8802 "%" upcoming', v.cycle_label;
END $$;

-- ------------------------------------------------------------
-- D10 — a cycle dated under 036 (day after, three months less a day)
--       already in the series is still the resolved successor, and
--       the cycle generated after it begins on ITS end date.
-- ------------------------------------------------------------
INSERT INTO cycles (id, series_id, cycle_number, cycle_label, start_date, end_date, status)
VALUES ('60000000-0000-0000-0000-0000000db099', (SELECT id FROM series WHERE name='B'),
        8806, 'Apr 2028 – Jun 2028', '2028-04-01', '2028-06-30', 'upcoming');
DO $$ DECLARE v TEXT[]; v_next UUID; BEGIN
  v_next := mudarabah_next_cycle((SELECT id FROM cycles WHERE series_id = (SELECT id FROM series WHERE name='B') AND cycle_number = 8805));
  IF v_next <> '60000000-0000-0000-0000-0000000db099' THEN
    RAISE EXCEPTION 'TEST FAIL D10: day-after cycle not resolved as successor (got %)', v_next;
  END IF;
  v := _chain('B', 1);
  -- 30 Jun is June's last day, so the series anchor (31) speaks: 30 Sep.
  IF v <> ARRAY['2028-06-30→2028-09-30'] THEN
    RAISE EXCEPTION 'TEST FAIL D10: got %, expected 30 Jun 2028 → 30 Sep 2028', v;
  END IF;
  RAISE NOTICE 'PASS D10 — 036-era cycle coexists; next begins on its end date (%)', v[1];
END $$;

-- ------------------------------------------------------------
-- D11 — a cancelled cycle does not set the series' anchor. Series A
--       runs on the 30th; a cancelled cycle that began on a 31st is
--       ignored, so after February the chain returns to the 30th,
--       not the 31st.
-- ------------------------------------------------------------
INSERT INTO cycles (id, series_id, cycle_number, cycle_label, start_date, end_date, status)
VALUES ('60000000-0000-0000-0000-0000000da000', (SELECT id FROM series WHERE name='A'),
        8800, 'Jan 2026 – Apr 2026', '2026-01-31', '2026-04-30', 'cancelled');
DO $$ DECLARE v TEXT[]; BEGIN
  v := _chain('A', 3);
  IF v <> ARRAY['2028-08-30→2028-11-30',
                '2028-11-30→2029-02-28',
                '2029-02-28→2029-05-30'] THEN
    RAISE EXCEPTION 'TEST FAIL D11: got %', v;
  END IF;
  RAISE NOTICE 'PASS D11 — cancelled 31st ignored; February recovers to the 30th';
END $$;

-- ------------------------------------------------------------
-- D12 — the anchor speaks only to a month-end start. A cycle an
--       administrator made by hand on the 14th, in a series whose
--       anchor is the 30th, is continued on the 14th.
-- ------------------------------------------------------------
INSERT INTO cycles (id, series_id, cycle_number, cycle_label, start_date, end_date, status)
VALUES ('60000000-0000-0000-0000-0000000da890', (SELECT id FROM series WHERE name='A'),
        8890, 'Sep 2029 – Dec 2029', '2029-09-14', '2029-12-14', 'upcoming');
DO $$ DECLARE v TEXT[]; BEGIN
  v := _chain('A', 2);
  IF v <> ARRAY['2029-12-14→2030-03-14',
                '2030-03-14→2030-06-14'] THEN
    RAISE EXCEPTION 'TEST FAIL D12: got %, expected the 14th to stay the 14th', v;
  END IF;
  RAISE NOTICE 'PASS D12 — a mid-month start is never pushed to the anchor';
END $$;

ROLLBACK;
