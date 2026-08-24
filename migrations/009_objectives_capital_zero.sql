-- 009: objectives.capital_approved CHECK (>= 0) — selaras desain F3 "belajar dulu"
--
-- Root cause (ditemukan 2026-08-24, wizard onboarding user):
--   UI wizard step "Economic Baseline" membiarkan capital = 0 (default "0").
--   step5 lalu INSERT objectives dengan capital_approved = 0 → melanggar
--   CHECK (capital_approved > 0) → error Postgres mentah ("new row for relation
--   "objectives" violates check constraint "objectives_capital_approved_check"")
--   bocor ke UI.
--
-- Niat desain F3 (komentar packages/api/src/index.ts:1379):
--   "target_profit tanpa modal > 0 → invalid; capital 0 → objective 'belajar
--    dulu' (RESEARCH-only)" — objective tanpa modal adalah state VALID.
--
-- Fix kelas-bug (bukan per-site): relax constraint di schema — capitalApproved
-- NUMERIC(20,2) NOT NULL CHECK (capital_approved >= 0). Validasi bisnis
-- (capital=0 → RESEARCH-only) tetap tanggung jawab lapisan aplikasi.
--
-- Keamanan data: 0 baris existing dengan capital_approved <= 0 (62 total, diverifikasi
-- 2026-08-24 di DB prod sebelum migrasi) — migrasi idempotent, tanpa backfill.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'objectives_capital_approved_check'
      AND conrelid = 'objectives'::regclass
  ) THEN
    ALTER TABLE objectives DROP CONSTRAINT objectives_capital_approved_check;
  END IF;
END $$;

ALTER TABLE objectives
  ADD CONSTRAINT objectives_capital_approved_check
  CHECK (capital_approved >= 0);
