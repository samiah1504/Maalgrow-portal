-- ============================================================
-- 049 — cycle dates: same-day start, anchored three months
--
-- Changes ONE function, create_next_cycle(p_series_id), and nothing
-- else. No table, no row, no other function. Existing cycles keep
-- the dates they have: rewriting them would move live investors'
-- maturity dates and instruction deadlines under them.
--
-- ── WHAT 036 DID, AND WHAT IT PRODUCED ──────────────────────
--
-- Migration 036 made a generated cycle begin the DAY AFTER its
-- predecessor ends and run "three months less a day". Postgres
-- clamps a month-end date when the target month is shorter, and
-- because each cycle was chained off the previous one, every clamp
-- became permanent. Measured on production, from a cycle ending
-- 30 Aug 2026:
--
--   31 Aug 2026 – 29 Nov 2026
--   30 Nov 2026 – 27 Feb 2027
--   28 Feb 2027 – 27 May 2027      the 30th is never seen again
--
-- The administrators' own convention, used for every cycle created
-- by hand and expected of the generated ones, is that a cycle ending
-- on the 30th is followed by one running 30th to 30th:
--
--   30 Aug 2026 – 30 Nov 2026
--   30 Nov 2026 – 28 Feb 2027      February clamps, as it must
--   28 Feb 2027 – 30 May 2027      and the 30th comes back
--
-- ── THE RULE ─────────────────────────────────────────────────
--
--   start = the previous cycle's end_date            (the same day)
--   end   = three calendar months on, on the series' anchor day,
--           clamped to the target month's length
--
-- The anchor day is the highest day-of-month on which any cycle in
-- the series has begun (the new start included, cancelled cycles
-- excluded). It is consulted only when the new start falls on the
-- last day of its month — the one case where the calendar may have
-- already clamped the date — so a series that genuinely runs on the
-- 1st, the 14th or the 28th is never pushed off its day. A series
-- on the 31st recovers after two consecutive clamps (30 Jun, 30 Sep,
-- then 31 Dec) because the anchor is remembered, not re-derived from
-- the clamped date.
--
-- ── COEXISTENCE ──────────────────────────────────────────────
--
-- mudarabah_next_cycle() resolves a successor as the earliest cycle
-- starting ON OR AFTER the source ends, so cycles dated under 036's
-- day-after rule and cycles dated under this one sit in the same
-- series without either being misread. Nothing about resolution
-- changes here; only what a newly generated cycle is dated.
--
-- Two cycles now share one calendar day, the old one's last and the
-- new one's first. That was the convention before 036 and every
-- reader already tolerates it (this migration's tests, D8, prove the
-- successor still resolves).
--
-- The Create Cycle and Edit Cycle forms in the portal compute their
-- own end date in the browser (start plus three months). They are
-- not touched by this migration.
--
-- Re-runnable. Grants unchanged: CREATE OR REPLACE keeps them.
-- ============================================================

CREATE OR REPLACE FUNCTION create_next_cycle(p_series_id UUID)
RETURNS UUID AS $$
DECLARE
  v_series        series%ROWTYPE;
  v_last_cycle    cycles%ROWTYPE;
  v_new_start     DATE;
  v_new_end       DATE;
  v_anchor_day    INTEGER;
  v_intended_day  INTEGER;
  v_end_month     DATE;      -- first day of the month three on
  v_end_month_len INTEGER;   -- how many days that month has
  v_cycle_number  INTEGER;
  v_cycle_label   TEXT;
  v_new_cycle_id  UUID;
BEGIN
  SELECT * INTO v_series FROM series WHERE id = p_series_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Series not found: %', p_series_id;
  END IF;

  SELECT * INTO v_last_cycle
  FROM cycles
  WHERE series_id = p_series_id
  ORDER BY cycle_number DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existing cycle found for series %', v_series.name;
  END IF;

  -- 049: the SAME day. A cycle ending on the 30th is followed by one
  -- beginning on the 30th.
  v_new_start := v_last_cycle.end_date;

  -- 049: the series' anchor day — the highest day-of-month any of its
  -- cycles has begun on, this one included.
  v_anchor_day := GREATEST(
    EXTRACT(DAY FROM v_new_start)::INTEGER,
    COALESCE((
      SELECT MAX(EXTRACT(DAY FROM start_date))::INTEGER
      FROM cycles
      WHERE series_id = p_series_id
        AND status <> 'cancelled'
    ), 0)
  );

  -- The day this cycle was MEANT to begin on. Only a start that sits
  -- on the last day of its month can be a clamped one, so only then
  -- does the anchor speak; every other start means what it says.
  IF v_new_start = (DATE_TRUNC('month', v_new_start) + INTERVAL '1 month' - INTERVAL '1 day')::DATE THEN
    v_intended_day := v_anchor_day;
  ELSE
    v_intended_day := EXTRACT(DAY FROM v_new_start)::INTEGER;
  END IF;

  -- Three months on, on the intended day, clamped to that month.
  v_end_month     := (DATE_TRUNC('month', v_new_start) + INTERVAL '3 months')::DATE;
  v_end_month_len := EXTRACT(DAY FROM (v_end_month + INTERVAL '1 month' - INTERVAL '1 day'))::INTEGER;
  v_new_end       := v_end_month + (LEAST(v_intended_day, v_end_month_len) - 1);

  v_cycle_number := v_last_cycle.cycle_number + 1;
  v_cycle_label  := TO_CHAR(v_new_start, 'Mon YYYY') || ' – ' || TO_CHAR(v_new_end, 'Mon YYYY');

  INSERT INTO cycles (series_id, cycle_number, cycle_label, start_date, end_date, status)
  VALUES (p_series_id, v_cycle_number, v_cycle_label, v_new_start, v_new_end, 'upcoming')
  RETURNING id INTO v_new_cycle_id;

  RETURN v_new_cycle_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
