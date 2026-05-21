-- Company tenancy refactor.
--
-- Replaces the implicit "tenant = users.company_name string" model
-- with an explicit `companies` UUID tenant. Adds a tenant-scoped
-- monthly budget column on companies (was a deployment-wide
-- singleton on org_settings).
--
-- Steps:
--   1. CREATE companies table (UUID PK + display fields + tenant-
--      scoped monthlyBudgetCents).
--   2. ALTER users ADD company_id FK + index on (company_id).
--   3. Backfill: one companies row per distinct normalised
--      company_name, link every company-profile user to their tenant.
--      Same-name duplicates collapse into one tenant — preserves the
--      de-facto pre-migration semantics. New self-signups going
--      forward get their own UUID even on name collision.
--   4. Backfill companies.monthly_budget_cents from the legacy
--      singleton org_settings row (if one exists). Existing tenants
--      keep the cap that previously applied to them; new tenants
--      start at NULL ("no target set").

CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"industry" text,
	"team_size" text,
	"infra_choice" text,
	"monthly_budget_cents" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "company_id" uuid;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "users_company_id_idx" ON "users" USING btree ("company_id");
--> statement-breakpoint
-- Step 3a: one companies row per distinct normalised name. DISTINCT
-- ON keeps the earliest-onboarded row's industry/teamSize/
-- infraChoice so the migration doesn't silently switch company
-- metadata. Trim before insert and skip whitespace-only names so a
-- legacy row like "  " doesn't mint a blank-name tenant.
INSERT INTO "companies" ("name", "industry", "team_size", "infra_choice")
SELECT DISTINCT ON (lower(trim("company_name")))
	trim("company_name"),
	"industry",
	"team_size",
	"infra_choice"
FROM "users"
WHERE "company_name" IS NOT NULL
	AND trim("company_name") <> ''
	AND "profile_type" = 'company'
ORDER BY lower(trim("company_name")), "onboarding_completed_at" NULLS LAST;
--> statement-breakpoint
-- Step 3b: link every existing company-profile user to their tenant.
UPDATE "users" u
SET "company_id" = c."id"
FROM "companies" c
WHERE lower(trim(u."company_name")) = lower(trim(c."name"))
	AND u."profile_type" = 'company'
	AND u."company_id" IS NULL;
--> statement-breakpoint
-- Step 4: backfill the tenant-scoped budget from the legacy
-- deployment-wide singleton. Single-tenant deployments (the common
-- case so far) inherit the cap they had; multi-tenant deployments
-- inherit the same value on every tenant — admins can re-tune per
-- tenant via PATCH /org-settings after migrate.
UPDATE "companies"
SET "monthly_budget_cents" = (
	SELECT "monthly_budget_cents"
	FROM "org_settings"
	ORDER BY "created_at" ASC
	LIMIT 1
);
