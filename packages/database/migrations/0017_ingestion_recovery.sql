-- Stalled-ingestion recovery columns on knowledge_files.
--
-- When an ingestion worker died mid-job, the row it had moved to
-- `processing` was never re-picked (the claim only takes `pending`), so the
-- file stayed `processing` forever. These columns let a periodic reaper
-- distinguish a dead claim from a live one and reclaim only the dead ones:
--   - claimed_at: stamped at each pending→processing claim. A live worker's
--     claim stays fresh; the reaper reclaims rows whose claim is older than
--     the stale window, or NULL (orphaned before this column existed — e.g.
--     the SharePoint files stuck since June 4).
--   - attempts: bumped on each reclaim; after a cap the row goes terminal
--     `failed` instead of looping on a poison-pill file.
--
-- last_error is intentionally NOT added — the existing `ingestion_error`
-- column already serves that purpose.
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file.

ALTER TABLE "knowledge_files" ADD COLUMN IF NOT EXISTS "claimed_at" timestamp;
ALTER TABLE "knowledge_files" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0;
