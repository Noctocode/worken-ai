CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"industry" text,
	"team_size" text,
	"infra_choice" text,
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
-- Backfill: collapse existing `company_name` duplicates into a single
-- tenant. The previous schema treated lower(trim(company_name)) as
-- the implicit tenant identifier, so two users that share a
-- normalised name were already de facto the same tenant. Migrating
-- them into one companies row preserves that semantics; new
-- self-signups going forward get their own UUID even on name
-- collision (which is the whole point of this refactor).
--
-- Step 1: one companies row per distinct normalised name. DISTINCT
-- ON keeps the earliest-onboarded row's industry/teamSize/infraChoice
-- to avoid silently switching company metadata when the migration
-- runs.
INSERT INTO "companies" ("name", "industry", "team_size", "infra_choice")
SELECT DISTINCT ON (lower(trim("company_name")))
	"company_name",
	"industry",
	"team_size",
	"infra_choice"
FROM "users"
WHERE "company_name" IS NOT NULL
	AND "profile_type" = 'company'
ORDER BY lower(trim("company_name")), "onboarding_completed_at" NULLS LAST;
--> statement-breakpoint
-- Step 2: link every existing company-profile user to their tenant.
UPDATE "users" u
SET "company_id" = c."id"
FROM "companies" c
WHERE lower(trim(u."company_name")) = lower(trim(c."name"))
	AND u."profile_type" = 'company'
	AND u."company_id" IS NULL;
