-- Create the missing team_integration_links table.
--
-- The schema (packages/database/src/schema/index.ts) has declared
-- `teamIntegrationLinks` since the BYOK linking refactor, and
-- ModelsService.listEffectiveForUser + chat-transport both query it.
-- A migration creating the table was never committed, though, so on a
-- migrated-only deployment (prod) the relation doesn't exist and any
-- caller whose teamIds set is non-empty makes /models/effective return
-- HTTP 500 — which the FE renders as "Add at least 2 models" on
-- /compare-models even when the user has active aliases in the Models
-- tab. The Models tab (GET /models → findAll) doesn't touch this
-- table, hence the asymmetry users see in the wild.
--
-- This migration:
--   1. Creates the table to match the Drizzle schema 1:1 — same
--      columns, defaults, composite PK (team_id, integration_id),
--      FK cascade rules (team cascade, integration cascade,
--      linked_by SET NULL), and the integration_id reverse-lookup
--      index.
--   2. Backfills any legacy team-scoped `integrations` rows into the
--      new link model. Legacy rows duplicated the encrypted API key
--      onto one `integrations` row per team; the new model keeps a
--      single personal twin and links it into teams via this table,
--      so key rotation only has to land once. Backfill is the body
--      of packages/database/backfill/migrate-team-integrations-to-links.sql
--      (BEGIN/COMMIT stripped — the migration runner provides the
--      transaction; the doc-comment "Sanity" block was already
--      commented out and is not reproduced here).
--
-- Both steps are idempotent: re-running on a DB that already has the
-- table / has no legacy team-scoped rows is a no-op. Safe to apply on
-- a populated database.

CREATE TABLE IF NOT EXISTS "team_integration_links" (
	"team_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"linked_by" uuid,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "team_integration_links_team_id_integration_id_pk" PRIMARY KEY("team_id","integration_id")
);
--> statement-breakpoint
ALTER TABLE "team_integration_links" ADD CONSTRAINT "team_integration_links_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_integration_links" ADD CONSTRAINT "team_integration_links_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_integration_links" ADD CONSTRAINT "team_integration_links_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_integration_links_integration_idx" ON "team_integration_links" USING btree ("integration_id");--> statement-breakpoint

-- Backfill step 1: ensure a personal twin exists for every team-scoped
-- integrations row. Matched on (owner_id, provider_id, api_url) so a
-- custom LLM with a different URL doesn't collide with a personal
-- predef of the same providerId. is_enabled on the new personal row is
-- hard-coded to true: in the new model that column is the master
-- switch, and inheriting a paused team-row's flag would silently
-- disable BYOK across every other team for the same owner/provider.
INSERT INTO "integrations" (
	"owner_id",
	"team_id",
	"provider_id",
	"api_url",
	"api_key_encrypted",
	"is_enabled",
	"created_at",
	"updated_at"
)
SELECT DISTINCT ON (t.owner_id, t.provider_id, t.api_url)
	t.owner_id,
	NULL::uuid AS team_id,
	t.provider_id,
	t.api_url,
	t.api_key_encrypted,
	true AS is_enabled,
	t.created_at,
	t.updated_at
FROM "integrations" t
WHERE t.team_id IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM "integrations" p
		WHERE p.team_id IS NULL
			AND p.owner_id = t.owner_id
			AND p.provider_id = t.provider_id
			AND (
				(p.api_url IS NULL AND t.api_url IS NULL)
				OR p.api_url = t.api_url
			)
	)
ORDER BY t.owner_id, t.provider_id, t.api_url, t.created_at ASC;--> statement-breakpoint

-- Backfill step 2: create link rows pointing each legacy team_id at
-- the personal twin we just guaranteed exists. is_enabled is inherited
-- from the legacy team-row so members keep the same per-team toggle
-- state they had before. ON CONFLICT DO NOTHING covers the case where
-- someone manually pre-linked an integration.
INSERT INTO "team_integration_links" (
	"team_id",
	"integration_id",
	"is_enabled",
	"linked_by",
	"linked_at",
	"updated_at"
)
SELECT
	t.team_id,
	p.id AS integration_id,
	t.is_enabled,
	t.owner_id AS linked_by,
	t.created_at AS linked_at,
	NOW() AS updated_at
FROM "integrations" t
JOIN "integrations" p
	ON p.team_id IS NULL
	AND p.owner_id = t.owner_id
	AND p.provider_id = t.provider_id
	AND (
		(p.api_url IS NULL AND t.api_url IS NULL)
		OR p.api_url = t.api_url
	)
WHERE t.team_id IS NOT NULL
ON CONFLICT ("team_id", "integration_id") DO NOTHING;--> statement-breakpoint

-- Backfill step 3: drop the now-redundant team-scoped integrations
-- rows. After this, every BYOK key lives on a single personal row
-- and team-scoped use goes through team_integration_links.
DELETE FROM "integrations"
WHERE team_id IS NOT NULL;
