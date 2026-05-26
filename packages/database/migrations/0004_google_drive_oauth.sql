-- Google Drive integration: OAuth token storage + Drive import sources +
-- knowledge_files provenance columns.
--
-- Three additive changes, all safe on a populated database:
--   1. oauth_connections — provider-agnostic OAuth token store
--      (access + refresh, AES-GCM encrypted via existing
--      EncryptionService). Built provider-keyed so OneDrive /
--      Dropbox / etc. share the same table later. One row per
--      (owner, provider).
--   2. drive_import_sources — per-folder (or whole-drive) record
--      of what's been imported, so the FE can render a "Re-sync"
--      button per source. Detaching a source removes the record
--      but not the imported KC files (those go through the normal
--      KC delete path).
--   3. knowledge_files.source / external_id / external_url —
--      tracks provenance + lets us de-dupe re-imports of the same
--      Drive file by the same user.

CREATE TABLE "oauth_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"access_token_encrypted" text NOT NULL,
	-- Drive may omit refresh_token on re-consent if the user already
	-- granted offline access for this client. We request prompt=consent
	-- on every connect to force a fresh refresh_token, but keep this
	-- column nullable so the code path stays safe under Google's edge
	-- cases.
	"refresh_token_encrypted" text,
	-- Space-separated scopes that were actually granted (Google can
	-- return a subset of what we requested). Compared against the
	-- required scope when surfacing the connection's usability.
	"scope" text NOT NULL,
	-- When the access_token expires. Refresh fires automatically when
	-- expires_at < now() + 60s on the next API call.
	"expires_at" timestamp with time zone NOT NULL,
	-- Display cache of the connected Google account's email. Shown in
	-- the FE status chip ("Connected as petra@…"). Not used for
	-- routing — owner_id is the source of truth.
	"account_email" text,
	-- 'active' | 'reauth_required'. Flipped to reauth_required when a
	-- refresh attempt fails (user revoked the grant in Google account
	-- settings, etc.); FE shows a "Reconnect" prompt then.
	"status" text NOT NULL DEFAULT 'active',
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_connections" ADD CONSTRAINT "oauth_connections_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- One connection per (owner, provider). Users reconnect by replacing
-- the existing row, not by accumulating duplicates.
CREATE UNIQUE INDEX "oauth_connections_owner_provider_unique" ON "oauth_connections" USING btree ("owner_id","provider");--> statement-breakpoint

CREATE TABLE "drive_import_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	-- 'all' for "Entire Drive" imports, 'folder' for a specific
	-- folder. Keeps the FE display logic simple — no NULL checks on
	-- drive_folder_id, just a dispatch on this column.
	"scope" text NOT NULL,
	-- Drive's fileId for the imported folder. NULL when scope='all'
	-- (Drive's root doesn't have a stable fileId we can rely on
	-- across "My Drive" / "Shared with me" — we walk the tree from
	-- about.get.user.rootFolderId at sync time instead).
	"drive_folder_id" text,
	-- Display name shown in the Re-sync UI. 'My Drive' for scope='all'.
	-- Cached at import time; not refreshed on rename in Drive (a
	-- future PR can pull this on each Re-sync if it becomes a real
	-- complaint).
	"drive_folder_name" text NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- How many KC files this source produced on its last sync. Used
	-- by the FE chip ("12 files imported"). Recomputed on every
	-- Re-sync.
	"file_count_at_last_sync" integer NOT NULL DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drive_import_sources" ADD CONSTRAINT "drive_import_sources_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_import_sources" ADD CONSTRAINT "drive_import_sources_connection_id_oauth_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."oauth_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- At most one source per (owner, drive_folder_id). Prevents importing
-- the same folder twice through the UI; the second click becomes a
-- Re-sync of the existing source.
CREATE UNIQUE INDEX "drive_import_sources_owner_folder_unique" ON "drive_import_sources" USING btree ("owner_id","drive_folder_id") WHERE "drive_folder_id" IS NOT NULL;--> statement-breakpoint
-- At most one "Entire Drive" source per owner — same idea as above
-- but for scope='all' where drive_folder_id is NULL.
CREATE UNIQUE INDEX "drive_import_sources_owner_all_unique" ON "drive_import_sources" USING btree ("owner_id") WHERE "scope" = 'all';--> statement-breakpoint

-- knowledge_files provenance columns. `source` is NOT NULL with a
-- default so the ALTER is safe on a populated table (existing rows
-- get 'upload', matching their actual origin).
ALTER TABLE "knowledge_files" ADD COLUMN "source" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_files" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_files" ADD COLUMN "external_url" text;--> statement-breakpoint
-- De-dupe a re-import of the same Drive file by the same user. Partial
-- so source='upload' rows (external_id NULL) don't collide. Indexed
-- on uploaded_by_id first so the dedupe probe at import time is a
-- single B-tree lookup.
CREATE UNIQUE INDEX "knowledge_files_owner_external_unique" ON "knowledge_files" USING btree ("uploaded_by_id","external_id") WHERE "external_id" IS NOT NULL;
