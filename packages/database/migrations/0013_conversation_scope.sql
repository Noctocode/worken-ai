-- Per-conversation scope: 'personal' (private to the creator) or 'team'
-- (shared with the project's team). Replaces the client-side
-- "isTeamConversation" heuristic with server truth AND gates access —
-- a personal conversation is only visible to its owner, a team
-- conversation to anyone with project access.
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file.

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'personal' NOT NULL;

-- Preserve the previous (heuristic) classification: a conversation that
-- already has a message from someone OTHER than its creator was a
-- shared/team chat → mark it 'team'. Everything else stays 'personal'.
UPDATE "conversations" c
SET "scope" = 'team'
WHERE EXISTS (
  SELECT 1 FROM "messages" m
  WHERE m."conversation_id" = c."id"
    AND m."user_id" IS NOT NULL
    AND m."user_id" <> c."user_id"
);
