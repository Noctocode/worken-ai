-- DB-backed "fire import-complete notification" intent on knowledge_files.
--
-- The import-complete notification used to be driven by an in-memory Set on
-- the ingestion service, so it was lost across a cross-instance / reaper
-- handoff (the instance that drained the last file wasn't necessarily the one
-- that armed the intent) — a recovered import then completed silently.
--
-- Persisting the intent on the row makes it topology-independent: whichever
-- instance drains the final flagged file fires the notification, exactly once
-- (the fire is an atomic flag-clearing UPDATE … RETURNING). It also means a
-- stalled file recovered by the reaper still notifies, because the flag rode
-- along on the row the whole time.
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file.

ALTER TABLE "knowledge_files" ADD COLUMN IF NOT EXISTS "import_notify" boolean NOT NULL DEFAULT false;
