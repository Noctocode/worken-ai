-- Provider-specific config for integrations (Azure OpenAI).
--
-- Adds a jsonb `config` column holding the per-resource endpoint,
-- api-version, and deployment manifest that Azure OpenAI BYOK needs —
-- everything the other providers express through the flat columns.
-- Defaults to `{}` for every existing / non-Azure row. Azure keeps
-- `api_url` NULL so it stays covered by the predefined unique indexes;
-- its endpoint lives in this column instead.
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file.

ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "config" jsonb DEFAULT '{}'::jsonb NOT NULL;
