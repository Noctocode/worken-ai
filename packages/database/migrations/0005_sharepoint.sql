-- SharePoint (Microsoft Graph) integration: per-site / per-folder
-- import sources + an extra provenance column on knowledge_files so a
-- (driveId, itemId) pair can be reconstructed at download time.
--
-- All changes are additive and idempotent (IF NOT EXISTS) — re-running
-- this migration on a database that already has it is a no-op. Same
-- approach we adopted after the migration 0006 hot-fix incident.
--
-- The oauth_connections table is reused as-is; SharePoint connections
-- land there with provider='sharepoint'.

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
CREATE UNIQUE INDEX IF NOT EXISTS "sharepoint_import_sources_owner_site_unique" ON "sharepoint_import_sources" USING btree ("owner_id","site_id") WHERE "scope" = 'site';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sharepoint_import_sources_owner_folder_unique" ON "sharepoint_import_sources" USING btree ("owner_id","site_id","drive_id","folder_id") WHERE "scope" = 'folder';--> statement-breakpoint

ALTER TABLE "knowledge_files" ADD COLUMN IF NOT EXISTS "external_drive_id" text;
