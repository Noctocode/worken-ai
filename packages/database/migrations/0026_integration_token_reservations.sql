-- Per-key token-limit reservations (issue #226 #1: TOCTOU on the
-- BYOK/Custom monthly token gate).
--
-- A reservation is inserted in the same transaction that lets a call
-- through (reserving its upper-bound token estimate) and deleted once the
-- call finishes; the gate counts active reservations on top of recorded
-- usage so concurrent calls near the limit can't both pass on the same
-- stale total. `created_at` drives self-reaping of leaked rows.
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file.

CREATE TABLE IF NOT EXISTS "integration_token_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "integration_id" uuid NOT NULL,
  "estimated_tokens" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "integration_token_reservations"
    ADD CONSTRAINT "integration_token_reservations_integration_id_integrations_id_fk"
    FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "integration_token_reservations_integration_idx"
  ON "integration_token_reservations" ("integration_id", "created_at");
