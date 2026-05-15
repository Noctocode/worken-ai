-- Add content_sha256 to knowledge_files for upload-time duplicate
-- detection. New uploads compute a hex SHA-256 and the upload path
-- checks for prior rows with the same hash uploaded by the same
-- user (across all their folders) before inserting.
--
-- One-shot, idempotent. Safe before `pnpm db:push`; that push is a
-- no-op afterwards. Existing rows stay NULL — they simply opt out of
-- duplicate detection until re-uploaded.
ALTER TABLE knowledge_files
  ADD COLUMN IF NOT EXISTS content_sha256 text;

-- Two-column index so the per-uploader scope is enforced in the same
-- probe as the hash match. Same index name the schema declaration
-- emits, so `pnpm db:push` sees it as already present.
CREATE INDEX IF NOT EXISTS knowledge_files_owner_hash_idx
  ON knowledge_files (uploaded_by_id, content_sha256);
