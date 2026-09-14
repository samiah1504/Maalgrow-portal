-- ============================================================
-- Before you click Process Rollover
--
-- READ ONLY. Nothing here writes, updates or deletes.
--
-- WHAT "PENDING PROCESSING" MEANS. It is not an error and nothing is
-- stuck. The page counts:
--
--     status = 'matured' AND next_investment_id IS NULL
--
-- which is EXACTLY the set process_cycle_rollover loops over. So it is
-- simply the work the button is about to do — everyone whose cycle has
-- ended and who has not yet been moved on.
--
-- Someone who submitted their own instruction is usually NOT in it:
-- submit_rollover_decision runs mudarabah_enrol_next_cycle, which
-- moves them straight away and stamps next_investment_id. So the list
-- is mostly people who never answered (they default to profit paid,
-- capital continues), plus everyone who chose to exit, plus anyone
-- whose enrolment could not run at the time — usually because the next
-- cycle did not exist yet.
--
-- ── THE ONE THING WORTH FIXING FIRST ─────────────────────────
--
-- The rollover refuses an investor with no bank details for ANY
-- decision except the legacy rollover_all:
--
--     RAISE EXCEPTION 'Missing bank details for payout (investor %)'
--
-- That exception rolls back her whole iteration, so she is marked
-- 'failed' and HER CAPITAL DOES NOT MOVE INTO THE NEXT CYCLE. A
-- missing account number should hold up her profit payment, not her
-- capital — but today it holds up both, and she is not told.
--
-- So: run query 2, fill in any missing account, then click.
-- ============================================================

-- ------------------------------------------------------------
-- 0. SET THE CYCLE YOU ARE ABOUT TO ROLL OVER.
--
--    Take the id from the URL of the rollover page:
--    /admin/cycles/<THIS BIT>/rollover
-- ------------------------------------------------------------
\set cycle_id '00000000-0000-0000-0000-000000000000'

-- ------------------------------------------------------------
-- 1. WILL THE ROLLOVER RUN AT ALL?
--
--    Three things stop it before it touches anybody. Each is a plain
--    yes or no.
-- ------------------------------------------------------------
SELECT
  c.cycle_label,
  c.status                                        AS cycle_status,
  CASE WHEN EXISTS (SELECT 1 FROM cycle_profit_declarations d
                     WHERE d.cycle_id = c.id)
       THEN 'yes'
       ELSE 'NO — it will refuse: declare the Mudarabah profit first'
  END                                             AS profit_declared,
  COALESCE(n.cycle_label, 'NONE — it will refuse with NEXT_CYCLE_MISSING')
                                                  AS next_cycle,
  COALESCE(n.status::TEXT, '-')                   AS next_cycle_status,
  CASE WHEN n.id IS NULL THEN 'create and confirm the next cycle first'
       WHEN n.status::TEXT IN ('completed','cancelled','matured','awaiting_profit_declaration')
         THEN 'NO — the next cycle is closed to new allocations'
       ELSE 'yes'
  END                                             AS next_cycle_open,
  (SELECT COUNT(*) FROM investments i
    WHERE i.cycle_id = c.id
      AND i.status::TEXT = 'matured'
      AND i.next_investment_id IS NULL)           AS pending_processing
FROM cycles c
LEFT JOIN cycles n ON n.id = mudarabah_next_cycle(c.id)
WHERE c.id = :'cycle_id';

-- ------------------------------------------------------------
-- 2. EVERYONE PENDING, AND WHAT THE ROLLOVER WILL DO TO THEM
--
--    `will_happen` is the thing to read. Any row saying WILL FAIL is
--    an investor whose capital will not move — fix those first.
--
--    Bank details are resolved exactly as the function resolves them:
--    from the instruction row if she gave one, otherwise from her
--    investor record.
-- ------------------------------------------------------------
SELECT
  inv.full_name,
  inv.investor_code,
  i.investment_code,
  i.units                                    AS slots,
  i.capital,
  i.declared_profit_net                      AS profit_to_be_paid,
  COALESCE(rd.decision::TEXT, 'no instruction — defaults to continue')
                                             AS instruction,
  COALESCE(rd.bank_name,      inv.bank_name)      AS bank,
  COALESCE(rd.account_number, inv.account_number) AS account,
  CASE
    WHEN i.declared_profit IS NULL
      THEN 'WILL FAIL — no declared profit for this enrolment'
    WHEN COALESCE(rd.decision::TEXT, 'continue') <> 'rollover_all'
     AND (COALESCE(rd.bank_name,      inv.bank_name)      IS NULL
       OR COALESCE(rd.account_name,   inv.account_name)   IS NULL
       OR COALESCE(rd.account_number, inv.account_number) IS NULL)
      THEN 'WILL FAIL — no bank details, and her CAPITAL will not move either'
    WHEN rd.decision::TEXT = 'exit'
      THEN 'paid out in full — capital and profit'
    WHEN rd.decision::TEXT = 'partial_exit'
      THEN 'part withdrawn, the rest continues'
    WHEN rd.decision::TEXT = 'rollover_all'
      THEN 'capital AND profit both continue (nothing paid out)'
    ELSE 'profit paid, capital continues into the next cycle'
  END                                        AS will_happen
FROM investments i
JOIN investors inv ON inv.id = i.investor_id
LEFT JOIN rollover_decisions rd ON rd.investment_id = i.id
WHERE i.cycle_id = :'cycle_id'
  AND i.status::TEXT = 'matured'
  AND i.next_investment_id IS NULL
ORDER BY
  (COALESCE(rd.decision::TEXT, 'continue') <> 'rollover_all'
   AND (COALESCE(rd.bank_name,      inv.bank_name)      IS NULL
     OR COALESCE(rd.account_name,   inv.account_name)   IS NULL
     OR COALESCE(rd.account_number, inv.account_number) IS NULL)) DESC,
  inv.full_name;

-- ------------------------------------------------------------
-- 3. THE SAME THING AS ONE LINE
--
--    If will_fail_no_bank is 0 and no_declared_profit is 0, nothing
--    in this cycle will be stranded. Click the button.
-- ------------------------------------------------------------
SELECT
  COUNT(*)                                                          AS pending_processing,
  COUNT(*) FILTER (WHERE rd.investment_id IS NULL)                  AS never_answered,
  COUNT(*) FILTER (WHERE rd.decision::TEXT = 'exit')                AS exiting,
  COUNT(*) FILTER (WHERE i.declared_profit IS NULL)                 AS no_declared_profit,
  COUNT(*) FILTER (
    WHERE COALESCE(rd.decision::TEXT, 'continue') <> 'rollover_all'
      AND (COALESCE(rd.bank_name,      inv.bank_name)      IS NULL
        OR COALESCE(rd.account_name,   inv.account_name)   IS NULL
        OR COALESCE(rd.account_number, inv.account_number) IS NULL)
  )                                                                 AS will_fail_no_bank
FROM investments i
JOIN investors inv ON inv.id = i.investor_id
LEFT JOIN rollover_decisions rd ON rd.investment_id = i.id
WHERE i.cycle_id = :'cycle_id'
  AND i.status::TEXT = 'matured'
  AND i.next_investment_id IS NULL;

-- ------------------------------------------------------------
-- 4. ANYONE A PREVIOUS RUN ALREADY MARKED FAILED
--
--    A failed row is not permanent: the investor stays 'matured' with
--    no next_investment_id, so the next run picks her up again. Fix
--    what the error names, then run it again.
-- ------------------------------------------------------------
SELECT
  inv.full_name,
  inv.investor_code,
  i.investment_code,
  cr.status,
  cr.error,
  cr.rollover_date
FROM cycle_rollovers cr
JOIN investments i  ON i.id = cr.previous_investment_id
JOIN investors  inv ON inv.id = cr.investor_id
WHERE cr.source_cycle_id = :'cycle_id'
  AND cr.status::TEXT = 'failed'
ORDER BY inv.full_name;
