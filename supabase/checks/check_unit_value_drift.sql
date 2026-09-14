-- ============================================================
-- Has any cycle's slot value drifted from its series price?
--
-- READ ONLY. Nothing here writes, updates or deletes.
--
-- WHY THIS MATTERS. Two functions enrol an investor into the next
-- cycle, and they price a slot differently:
--
--   mudarabah_enrol_next_cycle    COALESCE(dest.unit_value,
--                                          series.price_per_unit)
--                                 -> the CYCLE's own value
--
--   process_cycle_rollover        series.price_per_unit
--                                 -> the SERIES' CURRENT value
--
-- While those two numbers are equal, the paths agree and nothing is
-- wrong. They can come apart, because migration 006 froze each
-- existing cycle's unit_value to whatever the series price was AT
-- THAT MOMENT:
--
--   UPDATE cycles c SET unit_value = s.price_per_unit      -- 006:27
--    FROM series s WHERE c.series_id = s.id
--      AND c.unit_value IS NULL;
--
-- So if the series price was later changed — from 100,000 to 500,000,
-- say — every cycle that already existed still carries the old value,
-- and the two paths would then value the same slot differently by a
-- factor of five. mudarabah_set_cycle_overrides() can also set a
-- cycle's unit_value deliberately, with the same effect.
--
-- Query 1 answers whether that has actually happened here. Only your
-- database can; it cannot be read off the code.
-- ============================================================

-- ------------------------------------------------------------
-- 1. THE ANSWER
--
--    Any row marked DRIFTED is a cycle where the two enrolment paths
--    would disagree about what a slot is worth.
-- ------------------------------------------------------------
SELECT
  s.name                                   AS series,
  c.cycle_label,
  c.status                                 AS cycle_status,
  c.unit_value                             AS cycle_slot_value,
  s.price_per_unit                         AS series_slot_value,
  c.unit_value - s.price_per_unit          AS difference,
  CASE
    WHEN c.unit_value IS NULL
      THEN 'OK — no override, both paths use the series price'
    WHEN c.unit_value = s.price_per_unit
      THEN 'OK — the two agree'
    ELSE 'DRIFTED — the batch rollover would price this cycle''s slots at '
         || s.price_per_unit || ' while the submission path uses ' || c.unit_value
  END                                      AS verdict,
  (SELECT COUNT(*) FROM investments i WHERE i.cycle_id = c.id) AS enrolments
FROM cycles c
JOIN series s ON s.id = c.series_id
ORDER BY
  (c.unit_value IS NOT NULL AND c.unit_value <> s.price_per_unit) DESC,
  s.name, c.start_date;

-- ------------------------------------------------------------
-- 2. THE SERIES PRICES AS THEY STAND
--
--    One line each. If these are not what you expect a slot to be
--    worth today, stop — every figure below is computed from them.
-- ------------------------------------------------------------
SELECT
  s.name                  AS series,
  s.price_per_unit        AS slot_value,
  COUNT(c.id)             AS cycles,
  COUNT(c.id) FILTER (WHERE c.unit_value IS DISTINCT FROM s.price_per_unit)
                          AS cycles_that_disagree
FROM series s
LEFT JOIN cycles c ON c.series_id = s.id
GROUP BY s.name, s.price_per_unit
ORDER BY s.name;

-- ------------------------------------------------------------
-- 3. WHERE AN ENROLMENT'S OWN PRICE DISAGREES WITH ITS CYCLE
--
--    investments.price_per_unit is stamped when the enrolment is
--    created, so an old enrolment can carry an old price. Harmless
--    history in most cases, but if an ACTIVE one disagrees, its
--    capital and its slots are being valued two different ways.
-- ------------------------------------------------------------
SELECT
  s.name                                          AS series,
  c.cycle_label,
  inv.full_name,
  i.investment_code,
  i.status,
  i.units                                         AS slots,
  i.price_per_unit                                AS stamped_on_enrolment,
  COALESCE(c.unit_value, s.price_per_unit)        AS the_cycle_says,
  i.capital,
  ROUND(i.units * COALESCE(c.unit_value, s.price_per_unit), 2) AS slots_are_worth,
  i.capital - ROUND(i.units * COALESCE(c.unit_value, s.price_per_unit), 2)
                                                  AS capital_above_slot_value,
  i.rollover_balance
FROM investments i
JOIN investors inv ON inv.id = i.investor_id
JOIN cycles    c   ON c.id = i.cycle_id
JOIN series    s   ON s.id = i.series_id
WHERE i.price_per_unit IS DISTINCT FROM COALESCE(c.unit_value, s.price_per_unit)
   OR i.capital IS DISTINCT FROM ROUND(i.units * COALESCE(c.unit_value, s.price_per_unit), 2)
ORDER BY i.status, s.name, c.start_date, inv.full_name;

-- ------------------------------------------------------------
-- 4. ENROLMENTS CARRYING A ROLLOVER BALANCE
--
--    This is the case where the two paths' capital arithmetic comes
--    apart. The submission path sets capital = slots x price and puts
--    the leftover in rollover_balance. The batch sets capital = the
--    WHOLE carried amount and ALSO records the leftover in
--    rollover_balance, so the leftover is counted twice.
--
--    Empty means the divergence has never been exercised here.
-- ------------------------------------------------------------
SELECT
  s.name                    AS series,
  c.cycle_label,
  inv.full_name,
  i.investment_code,
  i.status,
  i.units                   AS slots,
  i.capital,
  i.rollover_balance,
  ROUND(i.units * COALESCE(c.unit_value, s.price_per_unit), 2) AS slots_are_worth,
  CASE
    WHEN i.capital = ROUND(i.units * COALESCE(c.unit_value, s.price_per_unit), 2)
      THEN 'submission path — capital is the slot value, balance sits beside it'
    WHEN i.capital = ROUND(i.units * COALESCE(c.unit_value, s.price_per_unit), 2)
                     + i.rollover_balance
      THEN 'BATCH path — the balance is inside capital AND in rollover_balance'
    ELSE 'neither shape — worth looking at directly'
  END                       AS which_path_made_it
FROM investments i
JOIN investors inv ON inv.id = i.investor_id
JOIN cycles    c   ON c.id = i.cycle_id
JOIN series    s   ON s.id = i.series_id
WHERE i.rollover_balance > 0
ORDER BY s.name, c.start_date, inv.full_name;
