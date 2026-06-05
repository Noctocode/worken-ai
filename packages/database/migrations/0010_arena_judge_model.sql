-- Arena judge-model persistence.
--
-- Records the "judge" model that scored each arena run's answers. The
-- judge is configurable (env default ARENA_JUDGE_MODEL, or a per-run UI
-- selection), so we store which evaluator produced the scores for the
-- run history. NULL for legacy runs created before this column existed.
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file.

ALTER TABLE "arena_runs" ADD COLUMN IF NOT EXISTS "judge_model" text;
