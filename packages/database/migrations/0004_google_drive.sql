-- Google Drive integration: OAuth token storage, Drive import sources,
-- knowledge_files provenance, and nested folders.
--
-- All changes are additive and safe on a populated database:
--   1. oauth_connections — provider-agnostic OAuth token store
--      (access + refresh, AES-GCM encrypted). One row per (owner, provider).
--   2. drive_import_sources — per-folder (or whole-drive) import record
--      so the FE can render a "Re-sync" button per source.
--   3. knowledge_files.source / external_id / external_url — provenance
--      + Drive de-dupe guard.
--   4. knowledge_folders.parent_folder_id — enables nested folders; NULL
--      = top-level (preserves all pre-migration rows).

CREATE TABLE "oauth_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text,
	"scope" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"account_email" text,
	"status" text NOT NULL DEFAULT 'active',
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_connections" ADD CONSTRAINT "oauth_connections_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_connections_owner_provider_unique" ON "oauth_connections" USING btree ("owner_id","provider");--> statement-breakpoint

CREATE TABLE "drive_import_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"drive_folder_id" text,
	"drive_folder_name" text NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"file_count_at_last_sync" integer NOT NULL DEFAULT 0,
	"visibility" text NOT NULL DEFAULT 'all',
	"team_ids" jsonb,
	"project_ids" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drive_import_sources" ADD CONSTRAINT "drive_import_sources_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_import_sources" ADD CONSTRAINT "drive_import_sources_connection_id_oauth_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."oauth_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drive_import_sources_owner_folder_unique" ON "drive_import_sources" USING btree ("owner_id","drive_folder_id") WHERE "drive_folder_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "drive_import_sources_owner_all_unique" ON "drive_import_sources" USING btree ("owner_id") WHERE "scope" = 'all';--> statement-breakpoint

ALTER TABLE "knowledge_files" ADD COLUMN "source" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_files" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_files" ADD COLUMN "external_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_files_owner_external_unique" ON "knowledge_files" USING btree ("uploaded_by_id","external_id") WHERE "external_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "knowledge_folders" ADD COLUMN "parent_folder_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_folders" ADD CONSTRAINT "knowledge_folders_parent_folder_id_knowledge_folders_id_fk" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."knowledge_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_folders_parent_idx" ON "knowledge_folders" USING btree ("parent_folder_id");
