ALTER TABLE "companies" ADD COLUMN "monthly_budget_cents" integer;
--> statement-breakpoint
-- Backfill from the legacy singleton org_settings row. Previously
-- there was a single org-wide cap shared across every tenant — copy
-- that value onto every existing companies row so the cap is
-- preserved on the boundary it actually applied to (mostly: one
-- tenant deployments where the singleton and the tenant coincided).
-- New tenants from this migration forward set their own cap via
-- /org-settings PATCH and start at NULL ("no target set").
UPDATE "companies"
SET "monthly_budget_cents" = (
	SELECT "monthly_budget_cents"
	FROM "org_settings"
	ORDER BY "created_at" ASC
	LIMIT 1
);
