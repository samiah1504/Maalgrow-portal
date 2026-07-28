-- ============================================================
-- 040 — remove BVN
--
-- WHY. A Bank Verification Number is among the most sensitive things
-- a Nigerian financial record can hold, and this portal was collecting
-- it as a REQUIRED field on the investor KYC form while using it for
-- nothing. Data you do not use is data you can only lose: it cannot
-- help you, and it can be breached, subpoenaed or mishandled.
--
-- The right response to "we do not need this" is not to hide the
-- field. Hiding it leaves every stored number exactly where it was,
-- with the same exposure and none of the visibility. So this deletes
-- them.
--
-- ── THIS ONE IS NOT REVERSIBLE ───────────────────────────────
--
-- Every other migration in this project can be re-run and undone.
-- This one destroys data on purpose. Once it has run, no BVN this
-- portal ever held can be recovered from it — not from a later
-- migration, not from the application, not from a support request.
-- Only a backup taken BEFORE it ran would still contain them.
--
-- That is the intended outcome. It is stated plainly here because
-- somebody reading this file in a year should not have to infer it.
--
-- ── OVERWRITTEN, THEN DROPPED ────────────────────────────────
--
-- The UPDATE is not strictly necessary — dropping a column removes
-- the values with it. It runs first anyway: DROP COLUMN in Postgres
-- is a catalogue change, and the old bytes can linger in the heap
-- until the pages are rewritten. Overwriting the values first means
-- the sensitive digits are replaced by NULLs in the row images before
-- the column disappears, rather than lying around in dead tuples for
-- as long as it takes autovacuum to get to them.
--
-- ── WHAT IS DELIBERATELY KEPT ────────────────────────────────
--
-- NIN. Only BVN was asked about, and NIN is a different identifier
-- serving a different purpose — removing it too would be a decision
-- nobody made.
--
-- KYC completeness is unaffected: kyc_missing_fields() never included
-- BVN, so no investor's status changes and nobody is newly flagged as
-- incomplete by this.
--
-- Re-runnable — the second run finds nothing to do.
-- ============================================================

-- 1. Overwrite the values while the column still exists.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'investors' AND column_name = 'bvn'
  ) THEN
    EXECUTE 'UPDATE investors SET bvn = NULL WHERE bvn IS NOT NULL';
  END IF;
END $$;

-- 2. Then remove the column itself, so nothing can write one again.
ALTER TABLE investors DROP COLUMN IF EXISTS bvn;

-- 3. Reclaiming the space is a SEPARATE step, run on its own:
--
--      VACUUM investors;
--
--    VACUUM cannot run inside a transaction block, and the Supabase
--    SQL editor wraps a script in one — leaving it here would fail
--    the whole migration and roll back the deletion above with it.
--    Autovacuum will get there on its own; running it by hand simply
--    makes it immediate.
