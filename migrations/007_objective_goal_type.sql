-- Migration 007: G4 — Customer intent (goal_type) di objectives
-- Idempoten: kolom mungkin sudah ada dari jalur deploy sebelumnya.
ALTER TABLE objectives ADD COLUMN IF NOT EXISTS goal_type text;

-- Backfill dari business_ventures.goal_type untuk objectives yang sudah ada
-- (hanya mengisi yang masih NULL agar aman dijalankan ulang)
UPDATE objectives o
SET goal_type = v.goal_type
FROM business_ventures v
WHERE o.business_venture_id = v.id AND v.goal_type IS NOT NULL AND o.goal_type IS NULL;
