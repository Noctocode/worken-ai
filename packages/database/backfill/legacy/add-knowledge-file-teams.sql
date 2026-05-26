-- Add the knowledge_file_teams join table for the new
-- `visibility='teams'` mode on knowledge_files.
--
-- Each row grants one team read access to one file at chat / arena
-- time. Empty link set === no one can read the file; the upload
-- path validates non-empty when visibility='teams'. Cascade on
-- both sides so deleting a file or a team cleans the links.
--
-- One-shot, idempotent. Safe before `pnpm db:push`; that push is a
-- no-op afterwards.
CREATE TABLE IF NOT EXISTS knowledge_file_teams (
  file_id    uuid NOT NULL REFERENCES knowledge_files (id) ON DELETE CASCADE,
  team_id    uuid NOT NULL REFERENCES teams (id)            ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (file_id, team_id)
);

-- Reverse lookup ("which files does team X see?") for team detail
-- pages and the chat-time membership probe.
CREATE INDEX IF NOT EXISTS knowledge_file_teams_team_idx
  ON knowledge_file_teams (team_id);
