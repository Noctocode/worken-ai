-- Many-to-many link between `projects` and `knowledge_files` so a
-- project can "attach" KC files for its chat RAG context. Replaces
-- the previous per-project upload destination — uploads from
-- Manage Context now land in KC and link here. Cascade on both
-- sides so deletions stay clean.
--
-- One-shot, idempotent. Safe to run before `pnpm db:push`; that
-- push is a no-op afterwards.
CREATE TABLE IF NOT EXISTS project_knowledge_files (
  project_id  uuid NOT NULL REFERENCES projects (id)        ON DELETE CASCADE,
  file_id     uuid NOT NULL REFERENCES knowledge_files (id) ON DELETE CASCADE,
  attached_by uuid REFERENCES users (id),
  attached_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, file_id)
);

-- Reverse-lookup index for "which projects use this file?"
CREATE INDEX IF NOT EXISTS project_knowledge_files_file_idx
  ON project_knowledge_files (file_id);
