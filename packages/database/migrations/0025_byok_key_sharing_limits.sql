-- BYOK / Custom LLM key sharing + per-key usage limits.
--
-- 1. integrations.allow_personal_use — when true, members of any team this
--    key is linked into may also use it in their PERSONAL scope (personal
--    projects / chats), not only inside the team. Default false keeps the
--    existing "team scope only" behaviour for keys already linked.
-- 2. integrations.monthly_token_limit — tri-state monthly usage cap counted
--    in tokens (NULL = no limit, 0 = paused, >0 = enforced). Tokens, not $,
--    because Custom LLM calls have no catalog price (cost_usd is NULL).
-- 3. observability_events.integration_id — which BYOK/Custom key served a
--    call, so the key-limit gate can sum month-to-date usage per key and the
--    admin can see a per-user breakdown. NULL for WorkenAI/OpenRouter routes.
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file.

ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "allow_personal_use" boolean NOT NULL DEFAULT false;
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "monthly_token_limit" integer;

ALTER TABLE "observability_events" ADD COLUMN IF NOT EXISTS "integration_id" uuid;

DO $$ BEGIN
  ALTER TABLE "observability_events"
    ADD CONSTRAINT "observability_events_integration_id_integrations_id_fk"
    FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "observability_events_integration_created_idx"
  ON "observability_events" ("integration_id", "created_at")
  WHERE "integration_id" IS NOT NULL;
