-- AI Cron 'schedule' visibility support for the cloud-import sources.
--
-- Drive / SharePoint / OneDrive imports persist the chosen visibility + link
-- ids on the source row so a re-sync reproduces them. Add a schedule_ids
-- column (parallel to team_ids / project_ids) so an import scoped to
-- visibility='schedule' re-links its files to the same AI Cron schedule(s)
-- on every re-sync.
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file.

ALTER TABLE "drive_import_sources" ADD COLUMN IF NOT EXISTS "schedule_ids" jsonb;
ALTER TABLE "sharepoint_import_sources" ADD COLUMN IF NOT EXISTS "schedule_ids" jsonb;
ALTER TABLE "onedrive_import_sources" ADD COLUMN IF NOT EXISTS "schedule_ids" jsonb;
