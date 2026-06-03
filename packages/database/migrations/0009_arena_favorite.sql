-- Arena "best answer" persistence.
--
-- Stores the model whose answer the user marked as best for a saved arena
-- run, so the green "Best" mark survives reload. NULL = no pick.
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file.

ALTER TABLE "arena_runs" ADD COLUMN IF NOT EXISTS "favorite_model" text;
