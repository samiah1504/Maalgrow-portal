-- ============================================================
-- 064 — MaalGrow cycles: the length is a setting, now 6 months
-- (agreed 15 Nov 2026)
--
-- APPLY ONLY AFTER supabase/checks/maalgrow_064_preflight.sql reports
-- ready_to_apply = true. Then run supabase/checks/maalgrow_064_postapply.sql.
-- To undo: supabase/checks/maalgrow_064_rollback.sql (refuses once any
-- ledger has a fourth month or a 6-month cycle has started).
--
-- Written with no indentation so it pastes cleanly from a phone.
--
-- 1. series.cycle_months — how long each new cycle of the series runs.
--    Every series is set to 6. New series default to 6.
-- 2. cycles.cycle_months — how long THIS cycle runs, kept on the cycle
--    so a later change to the series never moves its dates. Every
--    existing cycle is recorded with the length its dates already
--    span (3 for a 3-month cycle); no date changes.
-- 3. A cycle that has NOT started yet ('upcoming', last in its series)
--    is lengthened to 6 months now, with its investments' maturity
--    dates, so the next rollover is 6 months. Running and matured
--    cycles keep their 3-month dates. Audited.
-- 4. create_next_cycle (the rollover) uses the series' length, with
--    the same same-day anchored dates as 049.
-- 5. The Mudarabah ledger may hold as many months as its cycle runs
--    (1 to 12); a month beyond the cycle's length is refused.
-- 6. mudarabah_get_ledger also returns cycleMonths, so the ledger page,
--    settlement and report draw the right number of months.
--
-- No MaalGrow money, investment, ledger figure or settlement changes.
-- ============================================================

BEGIN;

ALTER TABLE series ADD COLUMN cycle_months INTEGER NOT NULL DEFAULT 3
CONSTRAINT series_cycle_months_check CHECK (cycle_months BETWEEN 1 AND 12);
ALTER TABLE cycles ADD COLUMN cycle_months INTEGER
CONSTRAINT cycles_cycle_months_check CHECK (cycle_months BETWEEN 1 AND 12);
-- Each existing cycle keeps the length its dates already span (3 months for a 3-month cycle)
UPDATE cycles SET cycle_months = GREATEST(1, LEAST(12, (
EXTRACT(YEAR FROM age(end_date, start_date)) * 12 + EXTRACT(MONTH FROM age(end_date, start_date))
+ CASE WHEN EXTRACT(DAY FROM age(end_date, start_date)) >= 15 THEN 1 ELSE 0 END)::INTEGER))
WHERE cycle_months IS NULL;
ALTER TABLE cycles ALTER COLUMN cycle_months SET NOT NULL;
UPDATE series SET cycle_months = 6;
ALTER TABLE series ALTER COLUMN cycle_months SET DEFAULT 6;

-- The end date of a cycle starting on p_start that runs p_months, on
-- the series' anchor day (049): a start clamped to a month's last day
-- means the anchor day; any other start means what it says.
CREATE OR REPLACE FUNCTION maalgrow_cycle_end(p_start DATE, p_months INTEGER, p_anchor_day INTEGER)
RETURNS DATE AS $$
DECLARE
v_intended INTEGER;
v_month    DATE;
v_len      INTEGER;
BEGIN
IF p_start = (DATE_TRUNC('month', p_start) + INTERVAL '1 month' - INTERVAL '1 day')::DATE THEN
v_intended := GREATEST(p_anchor_day, EXTRACT(DAY FROM p_start)::INTEGER);
ELSE
v_intended := EXTRACT(DAY FROM p_start)::INTEGER;
END IF;
v_month := (DATE_TRUNC('month', p_start) + make_interval(months => p_months))::DATE;
v_len := EXTRACT(DAY FROM (v_month + INTERVAL '1 month' - INTERVAL '1 day'))::INTEGER;
RETURN v_month + (LEAST(v_intended, v_len) - 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- A cycle inserted without a length takes its series' length
CREATE OR REPLACE FUNCTION maalgrow_cycle_months_default_trg()
RETURNS TRIGGER AS $$
BEGIN
IF NEW.cycle_months IS NULL THEN
SELECT cycle_months INTO NEW.cycle_months FROM series WHERE id = NEW.series_id;
NEW.cycle_months := COALESCE(NEW.cycle_months, 3);
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER maalgrow_cycle_months_default
BEFORE INSERT ON cycles
FOR EACH ROW EXECUTE FUNCTION maalgrow_cycle_months_default_trg();

CREATE OR REPLACE FUNCTION create_next_cycle(p_series_id UUID)
RETURNS UUID AS $$
DECLARE
v_series        series%ROWTYPE;
v_last_cycle    cycles%ROWTYPE;
v_new_start     DATE;
v_new_end       DATE;
v_anchor_day    INTEGER;
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
-- 049: the SAME day. A cycle ending on the 30th is followed by one beginning on the 30th.
v_new_start := v_last_cycle.end_date;
-- 049: the series' anchor day, the highest day-of-month any of its cycles has begun on
v_anchor_day := GREATEST(
EXTRACT(DAY FROM v_new_start)::INTEGER,
COALESCE((SELECT MAX(EXTRACT(DAY FROM start_date))::INTEGER FROM cycles
WHERE series_id = p_series_id AND status <> 'cancelled'), 0));
-- 064: the series' length (6 months), on the intended day, clamped to that month
v_new_end := maalgrow_cycle_end(v_new_start, v_series.cycle_months, v_anchor_day);
v_cycle_number := v_last_cycle.cycle_number + 1;
v_cycle_label  := TO_CHAR(v_new_start, 'Mon YYYY') || ' – ' || TO_CHAR(v_new_end, 'Mon YYYY');
INSERT INTO cycles (series_id, cycle_number, cycle_label, start_date, end_date, status, cycle_months)
VALUES (p_series_id, v_cycle_number, v_cycle_label, v_new_start, v_new_end, 'upcoming', v_series.cycle_months)
RETURNING id INTO v_new_cycle_id;
RETURN v_new_cycle_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- The ledger: as many months as the cycle runs
ALTER TABLE mudarabah_months DROP CONSTRAINT mudarabah_months_month_index_check;
ALTER TABLE mudarabah_months ADD CONSTRAINT mudarabah_months_month_index_check CHECK (month_index BETWEEN 1 AND 12);

CREATE OR REPLACE FUNCTION mudarabah_month_within_cycle_trg()
RETURNS TRIGGER AS $$
DECLARE v_months INTEGER;
BEGIN
SELECT c.cycle_months INTO v_months
FROM mudarabah_ledgers l JOIN cycles c ON c.id = l.cycle_id
WHERE l.id = NEW.ledger_id;
IF NEW.month_index > COALESCE(v_months, 3) THEN
RAISE EXCEPTION 'This cycle runs % months; there is no month %', COALESCE(v_months, 3), NEW.month_index;
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mudarabah_month_within_cycle
BEFORE INSERT OR UPDATE OF month_index, ledger_id ON mudarabah_months
FOR EACH ROW EXECUTE FUNCTION mudarabah_month_within_cycle_trg();

-- 064: the ledger also says how many months its cycle runs (as 033, plus cycleMonths)
CREATE OR REPLACE FUNCTION mudarabah_get_ledger(p_cycle_id UUID)
RETURNS JSONB AS $$
DECLARE
v_ledger   mudarabah_ledgers%ROWTYPE;
v_cycle    cycles%ROWTYPE;
v_series   series%ROWTYPE;
v_units    NUMERIC(12,2);
v_pooled   NUMERIC(20,2);
v_uv       NUMERIC(20,2);
BEGIN
SELECT * INTO v_cycle FROM cycles WHERE id = p_cycle_id;
IF NOT FOUND THEN RETURN NULL; END IF;
SELECT * INTO v_series FROM series WHERE id = v_cycle.series_id;
SELECT * INTO v_ledger FROM mudarabah_ledgers WHERE cycle_id = p_cycle_id;
v_uv := mudarabah_effective_unit_value(p_cycle_id);
SELECT COALESCE(SUM(units), 0) INTO v_units
FROM investments WHERE cycle_id = p_cycle_id AND status <> 'cancelled';
v_pooled := COALESCE(v_units, 0) * v_uv;
RETURN jsonb_build_object(
'cycleId',        p_cycle_id,
'ledgerId',       v_ledger.id,
'hasLedger',      v_ledger.id IS NOT NULL,
'seriesId',       v_cycle.series_id,
'seriesName',     v_series.name,
'cycleLabel',     v_cycle.cycle_label,
'cycleStatus',    v_cycle.status,
'startDate',      to_char(v_cycle.start_date, 'YYYY-MM-DD'),
'endDate',        to_char(v_cycle.end_date, 'YYYY-MM-DD'),
'cycleMonths',    v_cycle.cycle_months,
'termsLocked',    mudarabah_terms_locked(p_cycle_id),
'unitValue',      v_uv,
'ratio',          mudarabah_effective_ratio(p_cycle_id),
'whtRate',        mudarabah_effective_wht_rate(p_cycle_id),
'totalUnits',     COALESCE(v_units, 0),
'cycleTotalSlots', v_cycle.total_slots,
'pooledCapital',  v_pooled,
'amountReceived', v_cycle.amount_received,
'totalCapital',   v_cycle.total_capital,
'investorCount',  (SELECT COUNT(*) FROM investments
WHERE cycle_id = p_cycle_id AND status <> 'cancelled'),
'fundingGaps', COALESCE((
SELECT jsonb_agg(jsonb_build_object(
'investmentId',  g.investment_id,
'investorName',  g.investor_name,
'investorCode',  g.investor_code,
'units',         g.units,
'capital',       g.capital,
'confirmedPaid', g.confirmed_paid,
'gap',           g.gap
))
FROM investment_funding_gaps(p_cycle_id) g
), '[]'::JSONB),
'description',    v_ledger.description,
'discloseMode',   COALESCE(v_ledger.disclose_mode, 'perSlot'),
'status',         COALESCE(v_ledger.status, 'draft'),
'withdrawSlots', COALESCE((
SELECT SUM(
CASE
WHEN rd.decision::TEXT = 'exit' THEN i.units
WHEN rd.decision::TEXT = 'partial_exit' THEN COALESCE(rd.slots_to_withdraw, 0)
ELSE 0
END
)
FROM investments i
LEFT JOIN rollover_decisions rd ON rd.investment_id = i.id
WHERE i.cycle_id = p_cycle_id AND i.status <> 'cancelled'
), 0),
'products', COALESCE((
SELECT jsonb_agg(jsonb_build_object('id', p.product_key, 'name', p.name) ORDER BY p.position)
FROM mudarabah_products p WHERE p.ledger_id = v_ledger.id
), '[]'::JSONB),
'months', COALESCE((
SELECT jsonb_agg(
jsonb_build_object(
'ads', m.ads, 'logistics', m.logistics,
'misc', m.misc, 'bankCharges', m.bank_charges,
'rows', COALESCE((
SELECT jsonb_agg(
jsonb_build_object(
'productId', p.product_key, 'qty', r.qty,
'unitCost', r.unit_cost, 'soldQty', r.sold_qty,
'sellPrice', r.sell_price, 'stockLeft', r.stock_left
) ORDER BY p.position
)
FROM mudarabah_month_rows r
JOIN mudarabah_products p ON p.id = r.product_id
WHERE r.month_id = m.id
), '[]'::JSONB)
) ORDER BY m.month_index
)
FROM mudarabah_months m WHERE m.ledger_id = v_ledger.id
), '[]'::JSONB),
'holders', COALESCE((
SELECT jsonb_agg(jsonb_build_object(
'investmentId', i.id,
'investorId',   i.investor_id,
'investorName', inv.full_name,
'investorCode', inv.investor_code,
'investorTin',  inv.tin,
'units',        i.units,
'capital',      i.capital,
'confirmedPaid', investment_confirmed_paid(i.id),
'capitalAction', CASE
WHEN rd.decision IS NULL THEN NULL
WHEN rd.decision::TEXT = 'exit' THEN 'withdraw'
WHEN rd.decision::TEXT = 'partial_exit' THEN 'partial'
ELSE 'rollover' END,
'slotsWithdrawn', CASE
WHEN rd.decision::TEXT = 'exit' THEN i.units
WHEN rd.decision::TEXT = 'partial_exit' THEN COALESCE(rd.slots_to_withdraw, 0)
ELSE 0 END
) ORDER BY inv.full_name)
FROM investments i
JOIN investors inv ON inv.id = i.investor_id
LEFT JOIN rollover_decisions rd ON rd.investment_id = i.id
WHERE i.cycle_id = p_cycle_id AND i.status <> 'cancelled'
), '[]'::JSONB)
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION maalgrow_cycle_months_default_trg() FROM PUBLIC;
REVOKE ALL ON FUNCTION mudarabah_month_within_cycle_trg() FROM PUBLIC;
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
REVOKE EXECUTE ON FUNCTION maalgrow_cycle_months_default_trg() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION mudarabah_month_within_cycle_trg() FROM anon, authenticated;
END IF;
END $$;

-- When 064 was applied (the rollback uses it)
DO $$ BEGIN PERFORM create_audit_log('maalgrow_064_applied', 'migration', '064', NULL, NULL); END $$;

-- Cycles that have not started yet become 6-month cycles now
DO $$
DECLARE
r       RECORD;
v_end   DATE;
v_label TEXT;
v_n     INTEGER;
BEGIN
FOR r IN
SELECT c.*, s.cycle_months AS series_months,
GREATEST(EXTRACT(DAY FROM c.start_date)::INTEGER,
COALESCE((SELECT MAX(EXTRACT(DAY FROM o.start_date))::INTEGER FROM cycles o
WHERE o.series_id = c.series_id AND o.status <> 'cancelled' AND o.start_date <= c.start_date), 0)) AS anchor_day
FROM cycles c JOIN series s ON s.id = c.series_id
WHERE c.status = 'upcoming' AND c.start_date > CURRENT_DATE AND c.cycle_months <> s.cycle_months
AND NOT EXISTS (SELECT 1 FROM cycles l WHERE l.series_id = c.series_id AND l.id <> c.id
AND l.status <> 'cancelled' AND l.start_date > c.start_date)
LOOP
v_end := maalgrow_cycle_end(r.start_date, r.series_months, r.anchor_day);
v_label := CASE WHEN r.cycle_label = TO_CHAR(r.start_date, 'Mon YYYY') || ' – ' || TO_CHAR(r.end_date, 'Mon YYYY')
THEN TO_CHAR(r.start_date, 'Mon YYYY') || ' – ' || TO_CHAR(v_end, 'Mon YYYY') ELSE r.cycle_label END;
UPDATE cycles SET end_date = v_end, cycle_months = r.series_months, cycle_label = v_label, updated_at = NOW()
WHERE id = r.id;
UPDATE investments SET maturity_date = v_end, updated_at = NOW()
WHERE cycle_id = r.id AND maturity_date = r.end_date;
GET DIAGNOSTICS v_n = ROW_COUNT;
PERFORM create_audit_log('cycle_lengthened_to_series_length', 'cycle', r.id::TEXT,
jsonb_build_object('end_date', r.end_date, 'cycle_months', r.cycle_months, 'cycle_label', r.cycle_label),
jsonb_build_object('end_date', v_end, 'cycle_months', r.series_months, 'cycle_label', v_label, 'investments_moved', v_n));
END LOOP;
END $$;

-- The built-in Capital Continuation message says how long the next cycle runs
UPDATE comm_templates SET body = replace(body, 'next 3-month investment cycle', 'next 6-month investment cycle')
WHERE name = 'Capital Continuation' AND body LIKE '%next 3-month investment cycle%';

COMMIT;
