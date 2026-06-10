-- Catch-up migration for a column skipped on already-deployed environments.
--
-- Background: `0011_integration_config` shipped first (journal `when`
-- 1779970000000) and was applied on production. It was later renumbered to
-- `0012_integration_config` (commit 9bcccef), and `0011_conversation_context`
-- took its place at the SAME `when` (1779970000000). Drizzle's migrator
-- applies only journal entries whose `when` is STRICTLY greater than the
-- last-applied migration's timestamp — so on any environment that had already
-- applied the original 0011 at 1779970000000, the new 0011_conversation_context
-- was silently skipped. `0013_conversation_scope` (when 1779990000000) still
-- applied, so prod ended up with `scope` but NOT `context`.
--
-- Every read/write of `conversations` selects all columns (Drizzle
-- `select()` / `.returning()`), so a missing `context` column makes even
-- creating a conversation fail with "column conversations.context does not
-- exist" (500). See issue #199.
--
-- Re-assert the columns with IF NOT EXISTS and a strictly-greater `when` so
-- this runs everywhere: a no-op where 0011/0013 already applied, the fix
-- where 0011 was skipped. Hand-authored to match this package's migration
-- style (drizzle meta snapshots aren't maintained — see 0006).

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "context" text;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'personal' NOT NULL;
