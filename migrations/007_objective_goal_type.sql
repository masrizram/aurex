-- Migration 007: G4 — Customer intent (goal_type) di objectives
ALTER TABLE objectives ADD COLUMN goal_type text;

-- Backfill dari business_ventures.goal_type untuk objectives yang sudah ada
UPDATE objectives o
SET goal_type = v.goal_type
FROM business_ventures v
WHERE o.business_venture_id = v.id AND v.goal_type IS NOT NULL;
