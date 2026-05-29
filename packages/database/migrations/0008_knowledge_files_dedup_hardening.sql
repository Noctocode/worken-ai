-- knowledge_files dedup index hardening (per Copilot review #5 follow-up).
--
-- The original `knowledge_files_owner_external_unique` index was created
-- with `WHERE external_id IS NOT NULL` — which inadvertently ALSO catches
-- SharePoint rows (they have external_id set). SharePoint item ids are
-- drive-scoped (the same itemId can legitimately exist in two different
-- document libraries), so a global-by-itemId uniqueness check produces
-- false collisions on SharePoint imports.
--
-- Tighten the predicate so the original index applies ONLY to rows where
-- external_drive_id IS NULL — which covers Drive (Drive ids ARE globally
-- unique, no driveId concept) and OneDrive (single user-drive per
-- account, no driveId column needed). SharePoint rows fall through
-- exclusively to `knowledge_files_owner_sp_external_unique`, which keys
-- on the (driveId, itemId) pair.
--
-- Idempotent — re-running this migration is a no-op.

DROP INDEX IF EXISTS "knowledge_files_owner_external_unique";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_files_owner_external_unique"
  ON "knowledge_files" USING btree ("uploaded_by_id", "external_id")
  WHERE "external_id" IS NOT NULL AND "external_drive_id" IS NULL;
