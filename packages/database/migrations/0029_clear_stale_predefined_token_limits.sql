-- One-time cleanup: clear stale per-key monthly token limits that were
-- set on predefined-provider integrations.
--
-- Background: an exhausted token cap on a predefined BYOK key (e.g. a
-- 5,000-token cap on Anthropic) was silently blocking every Claude call
-- in the arena. This migration wipes any such pre-existing limit once.
--
-- NOTE: predefined-provider BYOK keys *are* allowed to carry a monthly
-- token limit again (see the revert in the same PR) — this migration is
-- purely a historical cleanup of bad data and is intentionally NOT
-- re-applied, so limits set afterwards are preserved.
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file.

UPDATE "integrations" SET "monthly_token_limit" = NULL WHERE "provider_id" <> 'custom';
