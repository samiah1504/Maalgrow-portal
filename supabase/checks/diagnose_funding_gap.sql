-- ============================================================
-- Why does this cycle say slots have no confirmed payment?
--
-- READ ONLY. Nothing here writes, updates or deletes.
--
-- The warning comes from investment_funding_gaps (024), which does
-- one subtraction and nothing cleverer:
--
--     investments.capital  -  SUM(confirmed investment_payments)
--
-- It does not know or care how the enrolment was created. So the
-- same warning has several quite different causes, and they need
-- opposite responses:
--
--   A  ROLLED OVER, carry-forward never recorded
--      The enrolment has a parent. Money arrived in the previous
--      cycle and was never withdrawn; only the row saying so is
--      missing. This is what migration 046 repairs.
--
--   B  NEW ENROLMENT, payment entered but NOT CONFIRMED
--      Payment rows exist and are sitting at 'pending'. The money may
--      well be in the bank — somebody has to confirm it in the portal.
--      046 will NOT touch this.
--
--   C  NEW ENROLMENT, no payment row at all
--      Either the investor genuinely has not paid — in which case the
--      warning is correct and doing its job — or they paid and it was
--      never entered. Only your bank statement can tell those apart.
--      046 will NOT touch this either.
--
-- Query 1 sorts every gap in the portal into those three buckets.
-- ============================================================

-- ------------------------------------------------------------
-- 1. EVERY GAP, AND WHICH KIND IT IS
--
--    Start here. The `diagnosis` column is the answer.
-- ------------------------------------------------------------
SELECT
  s.name                    AS series,
  c.cycle_label,
  inv.full_name,
  inv.investor_code,
  i.investment_code,
  i.units                   AS slots,
  i.capital,
  investment_confirmed_paid(i.id)                    AS confirmed_paid,
  i.capital - investment_confirmed_paid(i.id)        AS gap,
  (i.parent_investment_id IS NOT NULL)               AS came_from_a_rollover,
  (SELECT COUNT(*) FROM investment_payments p
    WHERE p.investment_id = i.id)                    AS payment_rows,
  (SELECT STRING_AGG(DISTINCT p.status::TEXT, ', ') FROM investment_payments p
    WHERE p.investment_id = i.id)                    AS payment_states,
  CASE
    WHEN i.parent_investment_id IS NOT NULL
      THEN 'A — rolled over, carry-forward missing. Migration 046 repairs this.'
    WHEN EXISTS (SELECT 1 FROM investment_payments p
                  WHERE p.investment_id = i.id AND p.status::TEXT = 'pending')
      THEN 'B — payment entered but NOT CONFIRMED. Confirm it in the portal. 046 will not touch this.'
    WHEN NOT EXISTS (SELECT 1 FROM investment_payments p
                      WHERE p.investment_id = i.id)
      THEN 'C — no payment recorded at all. Either unpaid, or paid and never entered. 046 will not touch this.'
    ELSE 'D — part-paid. Confirmed money is short of the slots held.'
  END                       AS diagnosis
FROM investments i
JOIN investors inv ON inv.id = i.investor_id
JOIN cycles c      ON c.id = i.cycle_id
JOIN series s      ON s.id = i.series_id
WHERE i.status::TEXT = 'active'
  AND ABS(i.capital - investment_confirmed_paid(i.id)) > 0.005
ORDER BY s.name, c.cycle_label, ABS(i.capital - investment_confirmed_paid(i.id)) DESC;

-- ------------------------------------------------------------
-- 2. THE SAME THING COUNTED, ONE LINE PER CYCLE
--
--    Read this to see at a glance whether 046 has anything to do.
--    If `kind_A_rollover` is 0 everywhere, 046's backfill is a no-op
--    and the gap is a payments question, not a rollover question.
-- ------------------------------------------------------------
SELECT
  s.name AS series,
  c.cycle_label,
  COUNT(*)                                                   AS enrolments_with_a_gap,
  SUM(i.capital - investment_confirmed_paid(i.id))           AS total_gap,
  COUNT(*) FILTER (WHERE i.parent_investment_id IS NOT NULL) AS kind_A_rollover,
  COUNT(*) FILTER (
    WHERE i.parent_investment_id IS NULL
      AND EXISTS (SELECT 1 FROM investment_payments p
                   WHERE p.investment_id = i.id AND p.status::TEXT = 'pending')
  )                                                          AS kind_B_unconfirmed,
  COUNT(*) FILTER (
    WHERE i.parent_investment_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM investment_payments p
                       WHERE p.investment_id = i.id)
  )                                                          AS kind_C_no_payment
FROM investments i
JOIN cycles c ON c.id = i.cycle_id
JOIN series s ON s.id = i.series_id
WHERE i.status::TEXT = 'active'
  AND ABS(i.capital - investment_confirmed_paid(i.id)) > 0.005
GROUP BY s.name, c.cycle_label
ORDER BY s.name, c.cycle_label;

-- ------------------------------------------------------------
-- 3. IF IT IS KIND B — the unconfirmed money, listed
--
--    These are payments somebody entered and nobody confirmed. Each
--    one is a decision waiting: did this money actually arrive?
-- ------------------------------------------------------------
SELECT
  inv.full_name,
  inv.investor_code,
  i.investment_code,
  c.cycle_label,
  p.amount,
  p.units,
  p.payment_date,
  p.status,
  p.method,
  p.reference,
  p.created_at
FROM investment_payments p
JOIN investments i ON i.id = p.investment_id
JOIN investors inv ON inv.id = i.investor_id
JOIN cycles    c   ON c.id = i.cycle_id
WHERE p.status::TEXT <> 'confirmed'
  AND i.status::TEXT = 'active'
ORDER BY c.cycle_label, inv.full_name, p.payment_date;

-- ------------------------------------------------------------
-- 4. WHAT MIGRATION 046 WOULD ACTUALLY DO, IF ANYTHING
--
--    Exactly the migration's own backfill conditions. An empty
--    result means 046 writes nothing at all — its function fix still
--    matters for the next batch rollover you run, but it will not
--    change a single figure on any screen today.
-- ------------------------------------------------------------
SELECT
  inv.full_name,
  i.investment_code,
  c.cycle_label,
  p.investment_code                              AS rolled_over_from,
  i.capital,
  investment_confirmed_paid(i.id)                AS already_recorded,
  i.capital - investment_confirmed_paid(i.id)    AS would_be_written
FROM investments i
JOIN investors inv  ON inv.id = i.investor_id
JOIN cycles     c   ON c.id = i.cycle_id
JOIN investments p  ON p.id = i.parent_investment_id
WHERE i.parent_investment_id IS NOT NULL
  AND i.status::TEXT = 'active'
  AND i.capital > investment_confirmed_paid(i.id)
ORDER BY inv.full_name;
