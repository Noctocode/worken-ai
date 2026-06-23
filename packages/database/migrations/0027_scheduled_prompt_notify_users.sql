-- Extra in-app notification recipients for a scheduled prompt (issue #230).
--
-- Besides the owner (who always gets the run notification), the schedule
-- can notify additional members of the same company. Stored as a jsonb
-- array of user ids; NULL / empty means owner-only (the default).
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file.

ALTER TABLE "scheduled_prompts" ADD COLUMN IF NOT EXISTS "notify_user_ids" jsonb;
