-- Per-tenant feature flag for executable skills (Option #3).
--
-- Lives on `companies` next to monthly_budget_cents / web_search_enabled (the
-- per-tenant settings the legacy org_settings singleton was replaced by).
-- Default FALSE — the subsystem stays dark until an admin opts a tenant in; an
-- env kill-switch can force it off everywhere regardless.
--
-- Separate migration (not folded into 0021) so an already-applied 0021 is
-- never edited. Idempotent guard.

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "executable_skills_enabled" boolean DEFAULT false NOT NULL;
