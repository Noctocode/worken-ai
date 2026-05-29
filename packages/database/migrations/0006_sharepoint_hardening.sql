-- SharePoint hardening (per Copilot review #5 follow-up):
--
-- SharePoint item ids are drive-scoped, not globally unique across
-- libraries. The original dedup index on
-- (uploaded_by_id, external_id) treats every external_id as globally
-- unique — which is true for Drive (where Drive's fileId is the only
-- identifier and external_drive_id is always NULL) but NOT true for
-- SharePoint (where the (driveId, itemId) PAIR is what's unique).
--
-- Add a SharePoint-specific partial unique index that includes
-- external_drive_id in the key. The two indexes are non-overlapping
-- (the original keeps `WHERE external_id IS NOT NULL` semantics and
-- effectively only fires for Drive rows; the new one fires only for
-- source='sharepoint') so both can coexist without conflict.
--
-- Idempotent — re-running this migration is a no-op.

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_files_owner_sp_external_unique"
  ON "knowledge_files" USING btree (
    "uploaded_by_id",
    "external_drive_id",
    "external_id"
  )
  WHERE "source" = 'sharepoint';
