-- MaalGrow 065: the next cycle a rollover goes into is 6 months; finished rollovers stop showing.
-- ONE PART. Run ONCE, after the 065 preflight. Success = 065 applied
BEGIN;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'series' AND column_name = 'cycle_months') THEN
RAISE EXCEPTION 'STOP: run migration 064 first.';
END IF;
IF EXISTS (SELECT 1 FROM audit_logs WHERE action = 'maalgrow_065_applied') THEN
RAISE EXCEPTION 'STOP: 065 has already been applied. Do not run it again.';
END IF;
END $$;
-- >>> 065 BODY START

DO $$ BEGIN PERFORM create_audit_log('maalgrow_065_applied', 'migration', '065', NULL, NULL); END $$;

-- 1. Next cycles not opened yet run the series' length
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
WHERE c.status IN ('draft', 'upcoming', 'subscription_open', 'subscription_closed')
AND c.cycle_months < s.cycle_months
AND NOT EXISTS (SELECT 1 FROM cycles l WHERE l.series_id = c.series_id AND l.id <> c.id
AND l.status <> 'cancelled' AND l.start_date > c.start_date)
AND NOT EXISTS (SELECT 1 FROM mudarabah_months m JOIN mudarabah_ledgers g ON g.id = m.ledger_id WHERE g.cycle_id = c.id)
AND NOT EXISTS (SELECT 1 FROM cycle_profit_declarations d WHERE d.cycle_id = c.id)
LOOP
v_end := maalgrow_cycle_end(r.start_date, r.series_months, r.anchor_day);
v_label := CASE WHEN r.cycle_label = TO_CHAR(r.start_date, 'Mon YYYY') || ' – ' || TO_CHAR(r.end_date, 'Mon YYYY')
THEN TO_CHAR(r.start_date, 'Mon YYYY') || ' – ' || TO_CHAR(v_end, 'Mon YYYY') ELSE r.cycle_label END;
UPDATE cycles SET end_date = v_end, cycle_months = r.series_months, cycle_label = v_label, updated_at = NOW()
WHERE id = r.id;
UPDATE investments SET maturity_date = v_end, updated_at = NOW()
WHERE cycle_id = r.id AND maturity_date = r.end_date;
GET DIAGNOSTICS v_n = ROW_COUNT;
PERFORM create_audit_log('cycle_lengthened_before_rollover', 'cycle', r.id::TEXT,
jsonb_build_object('end_date', r.end_date, 'cycle_months', r.cycle_months, 'cycle_label', r.cycle_label),
jsonb_build_object('end_date', v_end, 'cycle_months', r.series_months, 'cycle_label', v_label, 'investments_moved', v_n));
END LOOP;
END $$;

-- 2. Finished rollovers are marked processed
DO $$
DECLARE r RECORD;
BEGIN
FOR r IN
SELECT c.id, c.cycle_label FROM cycles c
WHERE c.status = 'completed' AND c.rollover_processed_at IS NULL
AND EXISTS (SELECT 1 FROM cycle_profit_declarations d WHERE d.cycle_id = c.id)
AND NOT EXISTS (SELECT 1 FROM investments i WHERE i.cycle_id = c.id AND i.status = 'matured' AND i.next_investment_id IS NULL
AND NOT EXISTS (SELECT 1 FROM cycle_rollovers x WHERE x.previous_investment_id = i.id AND x.status IN ('completed', 'withdrawn')))
LOOP
UPDATE cycles SET rollover_processed_at = NOW(), updated_at = NOW() WHERE id = r.id;
PERFORM create_audit_log('rollover_marked_complete', 'cycle', r.id::TEXT, jsonb_build_object('rollover_processed_at', NULL),
jsonb_build_object('reason', 'every investor already moved or paid out', 'cycle_label', r.cycle_label));
END LOOP;
END $$;

-- <<< 065 BODY END
COMMIT;
SELECT '065 applied' AS result;
