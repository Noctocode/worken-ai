-- Per-conversation "Chat Context".
--
-- Backs the right-hand Project Details panel's "Chat Context" section
-- (Figma 238:17561) — a free-form, member-editable brief / task
-- framing scoped to a single conversation, distinct from the project
-- description. NULL = no context set (panel shows its empty state).
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file.

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "context" text;
