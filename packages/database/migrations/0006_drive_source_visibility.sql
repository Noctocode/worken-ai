-- Persist visibility settings on drive_import_sources so Re-sync can
-- reproduce the original visibility/team/project selection without
-- asking the user again. Three additive nullable-safe columns:
--   visibility  — mirrors knowledge_files.visibility; DEFAULT 'all' so
--                 existing rows stay behaving the same as before.
--   team_ids    — JSONB string[]; NULL unless visibility='teams'.
--   project_ids — JSONB string[]; NULL unless visibility='project'.

ALTER TABLE "drive_import_sources" ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'all';--> statement-breakpoint
ALTER TABLE "drive_import_sources" ADD COLUMN IF NOT EXISTS "team_ids" jsonb;--> statement-breakpoint
ALTER TABLE "drive_import_sources" ADD COLUMN IF NOT EXISTS "project_ids" jsonb;
