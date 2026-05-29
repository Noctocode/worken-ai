-- OneDrive integration + Microsoft OAuth consolidation.
--
-- Up to now, SharePoint connections lived in oauth_connections with
-- provider='sharepoint'. OneDrive uses the SAME Microsoft Graph API
-- with the SAME superset of scopes, so we consolidate to a single
-- provider='microsoft' row per user. The per-product enable state
-- lives in the new `features` JSONB column ({sharepoint?: bool,
-- onedrive?: bool}).
--
-- 1. Rename existing SharePoint rows.
-- 2. Add the features column. Existing rows get features={sharepoint:true}
--    so the user's already-connected SharePoint keeps working without
--    a reconnect.
-- 3. Create onedrive_import_sources, mirroring drive_import_sources
--    shape (single-drive structure, no site/library hierarchy).
--
-- All operations idempotent.

UPDATE "oauth_connections" SET "provider" = 'microsoft' WHERE "provider" = 'sharepoint';
--> statement-breakpoint

ALTER TABLE "oauth_connections"
  ADD COLUMN IF NOT EXISTS "features" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint

UPDATE "oauth_connections"
  SET "features" = '{"sharepoint": true}'::jsonb
  WHERE "provider" = 'microsoft' AND "features" = '{}'::jsonb;
--> statement-breakpoint

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
