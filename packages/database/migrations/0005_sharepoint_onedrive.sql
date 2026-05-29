-- SharePoint + OneDrive (Microsoft Graph) integration.
--
-- One squashed migration that lands the final state of this PR (was
-- four files during development: SharePoint base, dedup hardening,
-- OneDrive consolidation, dedup tightening).
--
-- Changes:
--   1. sharepoint_import_sources table (per-site / per-folder imports).
--   2. knowledge_files.external_drive_id column — SharePoint needs the
--      (driveId, itemId) pair at download time; Drive / OneDrive leave
--      it NULL since they have no driveId concept (Drive) or a single
--      user-drive (OneDrive).
--   3. Re-scope the Drive/OneDrive dedup index to NOT include
--      SharePoint rows. SharePoint item ids are drive-scoped (the same
--      itemId can appear in two libraries), so the global-by-itemId
--      assumption would otherwise produce false 23505s. Replaced by a
--      SharePoint-specific (driveId, itemId) partial index below.
--   4. Consolidate Microsoft auth: rename provider='sharepoint' rows to
--      provider='microsoft' and add a `features jsonb` column tracking
--      per-product enable flags ({sharepoint?:bool, onedrive?:bool}).
--      Both SharePoint and OneDrive Graph calls reuse the same token.
--   5. onedrive_import_sources table — mirrors drive_import_sources
--      shape (single-drive structure, no site/library hierarchy).
--
-- All operations are idempotent (IF NOT EXISTS / IF EXISTS / DO $$
-- duplicate_object guards), so re-running this migration on a database
-- that has already applied it is a no-op.

-- 1. SharePoint imports table + FKs + partial unique indexes.
CREATE TABLE IF NOT EXISTS "sharepoint_import_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"site_id" text NOT NULL,
	"site_name" text NOT NULL,
	"drive_id" text,
	"drive_name" text,
	"folder_id" text,
	"folder_name" text,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"file_count_at_last_sync" integer NOT NULL DEFAULT 0,
	"visibility" text NOT NULL DEFAULT 'all',
	"team_ids" jsonb,
	"project_ids" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "sharepoint_import_sources" ADD CONSTRAINT "sharepoint_import_sources_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "sharepoint_import_sources" ADD CONSTRAINT "sharepoint_import_sources_connection_id_oauth_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."oauth_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sharepoint_import_sources_owner_site_unique"
	ON "sharepoint_import_sources" USING btree ("owner_id","site_id")
	WHERE "scope" = 'site';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sharepoint_import_sources_owner_folder_unique"
	ON "sharepoint_import_sources" USING btree ("owner_id","site_id","drive_id","folder_id")
	WHERE "scope" = 'folder';
--> statement-breakpoint

-- 2. knowledge_files extra provenance column.
ALTER TABLE "knowledge_files" ADD COLUMN IF NOT EXISTS "external_drive_id" text;
--> statement-breakpoint

-- 3. Re-scope the Drive/OneDrive dedup index (was created in 0004 with
-- the looser predicate) so SharePoint rows fall through exclusively to
-- the SP-specific index added below.
DROP INDEX IF EXISTS "knowledge_files_owner_external_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_files_owner_external_unique"
	ON "knowledge_files" USING btree ("uploaded_by_id","external_id")
	WHERE "external_id" IS NOT NULL AND "external_drive_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_files_owner_sp_external_unique"
	ON "knowledge_files" USING btree (
		"uploaded_by_id",
		"external_drive_id",
		"external_id"
	)
	WHERE "source" = 'sharepoint';
--> statement-breakpoint

-- 4. Microsoft auth consolidation.
UPDATE "oauth_connections" SET "provider" = 'microsoft' WHERE "provider" = 'sharepoint';
--> statement-breakpoint
ALTER TABLE "oauth_connections"
	ADD COLUMN IF NOT EXISTS "features" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
UPDATE "oauth_connections"
	SET "features" = '{"sharepoint": true}'::jsonb
	WHERE "provider" = 'microsoft' AND "features" = '{}'::jsonb;
--> statement-breakpoint

-- 5. OneDrive imports table + FKs + partial unique indexes.
CREATE TABLE IF NOT EXISTS "onedrive_import_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"onedrive_folder_id" text,
	"onedrive_folder_name" text NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"file_count_at_last_sync" integer NOT NULL DEFAULT 0,
	"visibility" text NOT NULL DEFAULT 'all',
	"team_ids" jsonb,
	"project_ids" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "onedrive_import_sources" ADD CONSTRAINT "onedrive_import_sources_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "onedrive_import_sources" ADD CONSTRAINT "onedrive_import_sources_connection_id_oauth_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."oauth_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "onedrive_import_sources_owner_folder_unique"
	ON "onedrive_import_sources" USING btree ("owner_id", "onedrive_folder_id")
	WHERE "onedrive_folder_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "onedrive_import_sources_owner_all_unique"
	ON "onedrive_import_sources" USING btree ("owner_id")
	WHERE "scope" = 'all';
