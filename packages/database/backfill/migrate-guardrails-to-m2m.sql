-- Migrate guardrails from 1:1 (single team_id column) to N:M
-- (guardrail_teams join table).
--
-- One-shot, idempotent. Safe to run before `pnpm db:push` — the push
-- afterwards is a no-op because the schema this script produces
-- already matches src/schema/index.ts.
--
-- Why: "Hide email" -style guardrails should be reusable across
-- every team in an org. The old shape forced a copy-per-team and
-- silently hid an already-assigned rule from other teams' pickers.

BEGIN;

-- 1. New join table. Composite PK guarantees idempotency on the
--    copy step below: re-running the script doesn't duplicate
--    rows. ON DELETE CASCADE on both FKs covers GDPR team / rule
--    delete without leaving dangling links.
CREATE TABLE IF NOT EXISTS guardrail_teams (
  guardrail_id uuid NOT NULL
    REFERENCES guardrails(id) ON DELETE CASCADE,
  team_id uuid NOT NULL
    REFERENCES teams(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (guardrail_id, team_id)
);

CREATE INDEX IF NOT EXISTS guardrail_teams_team_idx
  ON guardrail_teams (team_id);

-- 2. Backfill from the legacy columns. ON CONFLICT DO NOTHING makes
--    this re-runnable. `assigned_by` defaults to the rule's owner —
--    the original team-assign endpoint required the owner to perform
--    the assign, so attributing it to ownerId is the closest historical
--    fact we have. `is_active` carries over from the legacy
--    `team_is_active` toggle so paused assignments stay paused.
INSERT INTO guardrail_teams (guardrail_id, team_id, is_active, assigned_by, assigned_at)
SELECT
  id,
  team_id,
  COALESCE(team_is_active, true),
  owner_id,
  created_at
FROM guardrails
WHERE team_id IS NOT NULL
ON CONFLICT (guardrail_id, team_id) DO NOTHING;

-- 3. Drop the now-redundant columns. IF EXISTS makes this idempotent.
ALTER TABLE guardrails DROP COLUMN IF EXISTS team_id;
ALTER TABLE guardrails DROP COLUMN IF EXISTS team_is_active;

COMMIT;
