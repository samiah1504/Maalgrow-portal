-- ============================================================
-- Is the profit stored for Series C actually right?
--
-- READ ONLY. Nothing here writes, updates or deletes. Safe to run on
-- production, safe to run twice, safe to stop halfway.
--
-- Run this BEFORE the 047 backfill. The backfill raises payment
-- requests from investments.declared_profit, so that column is what
-- has to be right — not what any screen shows.
--
-- The tab that showed ₦1,201 was dividing a naira figure by 100. That
-- was a display fault and it is fixed. These queries read the stored
-- column directly, so they cannot be lied to by a formatter.
-- ============================================================

-- ------------------------------------------------------------
-- 1. WHAT WAS DECLARED, AND BY WHOM
--
--    profit_per_slot is the headline number. Multiply it by your slot
--    count and it should be the investor pot you expect.
-- ------------------------------------------------------------
SELECT
  s.name                        AS series,
  c.cycle_label,
  c.status                      AS cycle_status,
  d.total_revenue,
  d.total_expenses,
  d.net_profit,
  d.investor_profit_share,
  d.company_profit_share,
  d.total_slots,
  d.profit_per_slot,
  d.wht_rate,
  d.profit_per_slot_net,
  d.total_wht,
  d.declared_at,
  p.full_name                   AS declared_by,
  d.notes
FROM cycle_profit_declarations d
JOIN cycles c   ON c.id = d.cycle_id
JOIN series s   ON s.id = c.series_id
LEFT JOIN profiles p ON p.id = d.declared_by
WHERE s.name = 'C'
ORDER BY c.start_date DESC;

-- ------------------------------------------------------------
-- 2. DOES THE LEDGER ADD UP TO THE DECLARATION?
--
--    declare_cycle_profit shares the pot out slot by slot and refuses
--    to finish unless the parts equal the whole. So these two columns
--    agreeing means the allocation ran cleanly; a difference means
--    something was edited afterwards and is the one result here worth
--    stopping for.
-- ------------------------------------------------------------
SELECT
  c.cycle_label,
  d.investor_profit_share                    AS declared_pot,
  SUM(i.declared_profit)                     AS sum_of_investor_shares,
  d.investor_profit_share - SUM(i.declared_profit) AS difference,
  CASE WHEN d.investor_profit_share - SUM(i.declared_profit) = 0
       THEN 'OK — the parts equal the whole'
       ELSE 'MISMATCH — do not run the backfill, ask about this first'
  END                                        AS verdict,
  COUNT(*)                                   AS investments,
  SUM(i.units)                               AS slots
FROM investments i
JOIN cycles c ON c.id = i.cycle_id
JOIN series s ON s.id = c.series_id
JOIN cycle_profit_declarations d ON d.cycle_id = c.id
WHERE s.name = 'C'
  AND i.status IN ('active', 'matured', 'completed')
  AND i.declared_profit IS NOT NULL
GROUP BY c.cycle_label, d.investor_profit_share
ORDER BY c.cycle_label;

-- ------------------------------------------------------------
-- 3. PER SLOT, PER INVESTOR — THE ACTUAL STORED NUMBERS
--
--    This is what the Awaiting tab was showing a hundredth of. What
--    you see here is what the payment request will be raised for.
--
--    profit_per_slot should be the same for everybody; if it is not,
--    the allocation was uneven and that is worth knowing.
-- ------------------------------------------------------------
SELECT
  inv.full_name,
  inv.investor_code,
  i.investment_code,
  i.units                                      AS slots,
  i.capital,
  i.declared_profit                            AS gross_profit,
  i.declared_wht                               AS withholding_tax,
  i.declared_profit_net                        AS net_profit_payable,
  ROUND(i.declared_profit / NULLIF(i.units, 0), 2) AS profit_per_slot,
  rd.decision                                  AS instruction,
  (SELECT COUNT(*) FROM payment_requests pr
    WHERE pr.investment_id = i.id)             AS requests_raised
FROM investments i
JOIN investors inv ON inv.id = i.investor_id
JOIN cycles c      ON c.id = i.cycle_id
JOIN series s      ON s.id = c.series_id
LEFT JOIN rollover_decisions rd ON rd.investment_id = i.id
WHERE s.name = 'C'
  AND i.declared_profit IS NOT NULL
ORDER BY c.start_date DESC, inv.full_name;

-- ------------------------------------------------------------
-- 4. EXACTLY WHO THE 047 BACKFILL WILL TOUCH, AND FOR HOW MUCH
--
--    Same conditions as the migration's own step 2, so this is a
--    dry run of it. If a name here surprises you, do not run 047.
-- ------------------------------------------------------------
SELECT
  inv.full_name,
  inv.investor_code,
  i.investment_code,
  c.cycle_label,
  rd.decision                    AS instruction,
  rd.submitted_at                AS answered_on,
  i.declared_profit_net          AS profit_to_be_requested,
  CASE WHEN rd.decision::TEXT = 'exit' THEN i.capital ELSE 0 END
                                 AS capital_to_be_requested,
  CASE
    WHEN COALESCE(rd.bank_name, inv.bank_name) IS NULL
      OR COALESCE(rd.account_number, inv.account_number) IS NULL
    THEN 'will be SKIPPED — no bank details'
    ELSE 'will be raised'
  END                            AS what_047_will_do
FROM investments i
JOIN rollover_decisions rd ON rd.investment_id = i.id
JOIN investors inv ON inv.id = i.investor_id
JOIN cycles c      ON c.id = i.cycle_id
WHERE i.declared_profit IS NOT NULL
  AND i.next_investment_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM payment_requests pr WHERE pr.investment_id = i.id
  )
ORDER BY inv.full_name;

-- ------------------------------------------------------------
-- 5. DID ANY INVESTOR ALREADY GET AN EMAIL WITH THE WRONG FIGURE?
--
--    The reminder email had the same fault as the tab, so anybody
--    reminded before the fix was told a profit a hundred times too
--    small. Empty here means nobody was, and there is nothing to
--    correct with them.
-- ------------------------------------------------------------
SELECT
  inv.full_name,
  inv.investor_code,
  r.to_address,
  r.sent_at,
  r.state,
  i.declared_profit_net AS the_correct_figure
FROM payment_request_reminders r
JOIN investments i  ON i.id = r.investment_id
JOIN investors inv  ON inv.id = i.investor_id
JOIN cycles c       ON c.id = i.cycle_id
JOIN series s       ON s.id = c.series_id
WHERE s.name = 'C'
  AND r.state = 'sent'
ORDER BY r.sent_at DESC;
