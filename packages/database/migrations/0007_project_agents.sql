-- Multi-agent projects.
--
-- A project now carries a *pool* of agent presets plus a single active
-- one, instead of a single implicit agent derived from `model`. The
-- active `agent` maps to `model` (the chat path still reads `model`);
-- switching the active agent from the project header updates both.
--
-- Written by hand rather than via `drizzle-kit generate`: the meta
-- snapshot is still in the broken `companies` / `enabled_models` state
-- documented in 0006, so generate prompts interactively and would fold
-- unrelated drift into this migration. These two ADD COLUMNs are the
-- only intended change.
--
-- Both columns are NOT NULL with defaults so existing rows backfill
-- cleanly: legacy projects get the general assistant as their active
-- agent and an empty pool (callers fall back to `[agent]`).

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "agent" text DEFAULT 'general-assistant' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "agents" jsonb DEFAULT '[]'::jsonb NOT NULL;
