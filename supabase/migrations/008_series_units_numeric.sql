-- Migration 008 – Change series min_units and max_units from INTEGER to NUMERIC
-- Allows fractional slot minimums (e.g. 0.5 slots)

ALTER TABLE series
  ALTER COLUMN min_units TYPE NUMERIC(8,2) USING min_units::NUMERIC(8,2),
  ALTER COLUMN max_units TYPE NUMERIC(8,2) USING max_units::NUMERIC(8,2);
