-- Confluence (Atlassian) integration.
--
-- Adds the confluence_import_sources table (per-space / per-page imports).
-- Confluence rows reuse knowledge_files.external_id (the page id, unique
-- within a site) and external_url (the page web link). They set
-- external_drive_id to the space id so they are EXCLUDED from the
-- Drive/OneDrive `knowledge_files_owner_external_unique` index (which
-- requires external_drive_id IS NULL) and instead dedupe through the
-- Confluence-specific partial unique index added below — so a Confluence
-- page id that happens to equal a Drive file id for the same user can't
-- raise a 23505. OAuth tokens reuse oauth_connections (provider='confluence').
--
-- All operations are idempotent (IF NOT EXISTS / DO $$ duplicate_object
-- guards), so re-running this migration on a database that already applied
-- it is a no-op.

CREATE TABLE IF NOT EXISTS "confluence_import_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"space_id" text NOT NULL,
	"space_key" text NOT NULL,
	"space_name" text NOT NULL,
	"page_id" text,
	"page_title" text,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"file_count_at_last_sync" integer NOT NULL DEFAULT 0,
	"visibility" text NOT NULL DEFAULT 'all',
	"team_ids" jsonb,
	"project_ids" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "confluence_import_sources" ADD CONSTRAINT "confluence_import_sources_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "confluence_import_sources" ADD CONSTRAINT "confluence_import_sources_connection_id_oauth_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."oauth_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "confluence_import_sources_owner_space_unique"
	ON "confluence_import_sources" USING btree ("owner_id","space_id")
	WHERE "scope" = 'space';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "confluence_import_sources_owner_page_unique"
	ON "confluence_import_sources" USING btree ("owner_id","space_id","page_id")
	WHERE "scope" = 'page';
--> statement-breakpoint

-- Confluence-specific dedup index. Source-scoped so a Confluence page id
-- can't collide with a Drive/OneDrive file id of the same string for the
-- same user (those rows keep external_drive_id NULL and live in
-- knowledge_files_owner_external_unique; Confluence rows set
-- external_drive_id to the space id, excluding them from it).
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_files_owner_confluence_external_unique"
	ON "knowledge_files" USING btree ("uploaded_by_id","external_id")
	WHERE "source" = 'confluence';
