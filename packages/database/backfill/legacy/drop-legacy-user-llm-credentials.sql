-- One-shot drop of the legacy `user_llm_credentials` table.
--
-- Background: until commit 595f986, onboarding step 5 wrote API keys
-- to `user_llm_credentials`. Nothing in the live system has read from
-- it since — the chat-transport BYOK path and the Integration tab
-- both read from `integrations`, and the legacy `getProfile` reader
-- was switched over in the same commit. The remaining rows were
-- copied across by `migrate-legacy-llm-credentials-to-integrations.sql`.
--
-- This is the cleanup. Drops the table so future devs don't see a
-- dead schema definition and start writing to it again.
--
-- Pre-flight check (read-only — does NOT modify anything):
--   SELECT
--     (SELECT count(*) FROM user_llm_credentials WHERE provider IN ('openai','anthropic')) AS legacy_total,
--     (
--       SELECT count(*) FROM user_llm_credentials ulc
--       WHERE ulc.provider IN ('openai','anthropic')
--         AND NOT EXISTS (
--           SELECT 1 FROM integrations i
--           WHERE i.owner_id = ulc.user_id
--             AND i.provider_id = ulc.provider
--             AND i.api_url IS NULL
--         )
--     ) AS unmigrated;
--
-- The `unmigrated` count MUST be 0 before running this. If it's not,
-- run `migrate-legacy-llm-credentials-to-integrations.sql` first.
--
-- Idempotent: `DROP TABLE IF EXISTS` so re-running is a no-op once
-- the table is gone. The FK constraint to `users.id` (ON DELETE
-- CASCADE) is dropped automatically with the table.
--
-- Run from repo root:
--   docker exec -i worken-postgres psql -U worken -d worken \
--     < packages/database/backfill/drop-legacy-user-llm-credentials.sql

BEGIN;

DROP TABLE IF EXISTS user_llm_credentials;

COMMIT;
