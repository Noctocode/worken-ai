-- Fixes the partial unique index on `integrations` after the team-scoped
-- BYOK migration (commit feat/team-byok-per-user-caps).
--
-- The schema change in apps/api widened the index predicate from
--   WHERE api_url IS NULL
-- to
--   WHERE api_url IS NULL AND team_id IS NULL
-- so personal and team-scoped rows for the same (owner, provider) can
-- coexist (admin can have a personal Anthropic key AND a team-shared
-- Anthropic key for a team they own).
--
-- drizzle-kit's `db:push` does not detect partial-index WHERE-clause
-- changes reliably, so existing databases must run this manually:
--
--   docker exec -i worken-postgres psql -U worken -d worken \
--     < packages/database/backfill/fix-personal-integrations-index-predicate.sql
--
-- Idempotent: drops and re-creates only the personal-scope index.

BEGIN;

DROP INDEX IF EXISTS integrations_owner_provider_predef_unique;

CREATE UNIQUE INDEX integrations_owner_provider_predef_unique
  ON integrations (owner_id, provider_id)
  WHERE api_url IS NULL AND team_id IS NULL;

COMMIT;
