-- Web search capability + per-project switch.
--
-- OpenRouter web search is enabled by augmenting a chat request with
-- `plugins: [{ id: "web" }]`. We gate it on two levels:
--
--   - capability (who is ALLOWED to use it): org default
--     `companies.web_search_enabled`, with an optional per-team override
--     `teams.web_search_enabled` (NULL = inherit the org default).
--   - per-project switch (the actual on/off for chat):
--     `projects.web_search`. Only effective when the resolved capability
--     (team ?? company) is enabled.
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file.

ALTER TABLE "companies" ADD COLUMN "web_search_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "teams" ADD COLUMN "web_search_enabled" boolean;
ALTER TABLE "projects" ADD COLUMN "web_search" boolean DEFAULT false NOT NULL;
