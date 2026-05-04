-- One-off backfill: copy openai/anthropic API keys from the legacy
-- `user_llm_credentials` table into the new `integrations` table so
-- they show up enabled in Management → Integration.
--
-- Background: until commit 595f986, onboarding step 5 wrote keys to
-- `user_llm_credentials`, which nothing in the live system reads from
-- (chat-transport BYOK and the Integration tab both read from
-- `integrations`). Users who onboarded before that fix (or before its
-- API restart took effect) typed keys that landed in dead storage —
-- their Integration tab shows every provider as "Not configured" even
-- though the encrypted blobs are right there in the legacy table.
--
-- This migration walks every legacy row for openai/anthropic and
-- inserts a matching `integrations` row with `is_enabled = true`,
-- reusing the SAME encrypted blob (no re-encryption needed — both
-- tables use the same EncryptionService key). Other legacy providers
-- (azure, private-vpc) are skipped because they don't 1:1 map to a
-- predefined provider and need additional fields (deployment URL,
-- VPC endpoint) the wizard never collected.
--
-- Idempotent: the NOT EXISTS guard means re-running is a no-op for
-- rows already migrated. Safe to apply multiple times. Doesn't touch
-- the legacy rows — leave them in place until a separate cleanup PR
-- drops the table once we've confirmed nothing else reads from it.
--
-- Verify before / after:
--   SELECT
--     (SELECT count(*) FROM user_llm_credentials WHERE provider IN ('openai','anthropic')) AS legacy,
--     (SELECT count(*) FROM integrations WHERE provider_id IN ('openai','anthropic') AND api_url IS NULL) AS migrated;
--
-- Run from repo root:
--   docker exec -i worken-postgres psql -U worken -d worken \
--     < packages/database/backfill/migrate-legacy-llm-credentials-to-integrations.sql

INSERT INTO integrations (owner_id, provider_id, api_url, api_key_encrypted, is_enabled, created_at)
SELECT
  ulc.user_id,
  ulc.provider,
  NULL,
  ulc.api_key_encrypted,
  TRUE,
  ulc.created_at
FROM user_llm_credentials ulc
WHERE ulc.provider IN ('openai', 'anthropic')
  AND NOT EXISTS (
    SELECT 1 FROM integrations i
    WHERE i.owner_id = ulc.user_id
      AND i.provider_id = ulc.provider
      AND i.api_url IS NULL
  );
