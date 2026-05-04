-- One-off backfill: mark legacy single-step profile-picker users as fully
-- onboarded so the tightened OnboardingGuard does not bounce them into the
-- new 6-step wizard.
--
-- Background: until this migration, auth.service.getUser computed
--   onboardingCompleted := !!onboarding_completed_at || !!profile_type
-- so users who only ever picked Company/Personal in the legacy flow were
-- treated as onboarded even though they never entered infra/LLM/docs. We
-- are tightening the BE to require onboarding_completed_at, which would
-- otherwise re-onboard those legacy users. Pre-flight by stamping a
-- timestamp for them here.
--
-- Idempotent: re-running is a no-op (WHERE clause excludes already-stamped
-- rows). Safe to apply multiple times.
--
-- Verify before/after:
--   SELECT COUNT(*) FILTER (WHERE profile_type IS NOT NULL AND onboarding_completed_at IS NULL) AS legacy_pending
--   FROM users;
--
-- Run from repo root:
--   docker exec -i worken-postgres psql -U worken -d worken < packages/database/backfill/backfill-legacy-onboarding-completed.sql

UPDATE users
SET onboarding_completed_at = COALESCE(updated_at, created_at, now())
WHERE profile_type IS NOT NULL
  AND onboarding_completed_at IS NULL;
