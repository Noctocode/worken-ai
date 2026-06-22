-- Monthly token limit is a Custom-LLM-only setting.
--
-- Predefined-provider integrations (anthropic, google, openai, …) — even
-- ones where the user added their own BYOK key — must not carry a per-key
-- monthly token limit; their usage is governed by the budget tiers, not a
-- token cap. Clear any limit that was previously set on a non-custom row
-- so a stale cap can't keep blocking those models (e.g. an exhausted
-- 5,000-token cap silently failing every Claude call in the arena).
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file.

UPDATE "integrations" SET "monthly_token_limit" = NULL WHERE "provider_id" <> 'custom';
