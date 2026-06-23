-- Auto-provisioned flag for model_configs aliases.
--
-- When an admin enables a predefined provider's BYOK key, that provider's
-- whole catalog is inserted into the Models tab as active aliases with
-- auto_provisioned=true; disabling the key removes only those rows.
-- Manually-added aliases (auto_provisioned=false) are never touched by
-- the provider enable/disable sync.
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file.

ALTER TABLE "model_configs" ADD COLUMN IF NOT EXISTS "auto_provisioned" boolean DEFAULT false NOT NULL;
