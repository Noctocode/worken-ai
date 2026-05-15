-- Migrate the legacy "team_id-on-integrations" model to the new
-- team_integration_links many-to-many table.
--
-- Why: old model duplicated the encrypted API key into a separate
-- integrations row per team (one personal row + N team-scoped rows
-- for the same provider). The new model stores the key once on a
-- personal row and links it into teams via team_integration_links,
-- so key rotation only has to land once.
--
-- What this does, in one transaction:
--   1. For every team-scoped row, find or create a personal twin
--      under the same owner_id + provider_id (+ api_url, for custom
--      LLMs). Personal twin matched on (owner, provider, api_url IS
--      [NOT] NULL) so a custom LLM with a different URL doesn't
--      collide with a personal predef of the same providerId.
--   2. Insert a team_integration_links row pointing the original
--      team_id at the personal twin. is_enabled inherited from the
--      team-scoped row so members keep the same toggle state.
--   3. Delete the now-redundant team-scoped row.
--
-- Idempotent: running twice on a DB that's already migrated finds no
-- team-scoped rows and exits cleanly. ON CONFLICT DO NOTHING on the
-- link insert covers the case where someone manually pre-linked.
--
-- Run with: psql -f migrate-team-integrations-to-links.sql

BEGIN;

-- Step 1: ensure a personal twin exists for every team-scoped row.
-- Personal predef twin = same owner_id + provider_id + api_url IS NULL.
-- For custom LLMs (provider_id = 'custom'), we match on (owner, url)
-- so two different on-prem endpoints stay distinct.
INSERT INTO integrations (
  owner_id,
  team_id,
  provider_id,
  api_url,
  api_key_encrypted,
  is_enabled,
  created_at,
  updated_at
)
SELECT DISTINCT ON (t.owner_id, t.provider_id, t.api_url)
  t.owner_id,
  NULL::uuid AS team_id,
  t.provider_id,
  t.api_url,
  t.api_key_encrypted,
  t.is_enabled,
  t.created_at,
  t.updated_at
FROM integrations t
WHERE t.team_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM integrations p
    WHERE p.team_id IS NULL
      AND p.owner_id = t.owner_id
      AND p.provider_id = t.provider_id
      AND (
        (p.api_url IS NULL AND t.api_url IS NULL)
        OR p.api_url = t.api_url
      )
  )
ORDER BY t.owner_id, t.provider_id, t.api_url, t.created_at ASC;

-- Step 2: create the link rows. JOIN on the same matching key to find
-- the personal twin we just guaranteed exists.
INSERT INTO team_integration_links (
  team_id,
  integration_id,
  is_enabled,
  linked_by,
  linked_at,
  updated_at
)
SELECT
  t.team_id,
  p.id AS integration_id,
  t.is_enabled,
  t.owner_id AS linked_by,
  t.created_at AS linked_at,
  NOW() AS updated_at
FROM integrations t
JOIN integrations p
  ON p.team_id IS NULL
 AND p.owner_id = t.owner_id
 AND p.provider_id = t.provider_id
 AND (
       (p.api_url IS NULL AND t.api_url IS NULL)
       OR p.api_url = t.api_url
     )
WHERE t.team_id IS NOT NULL
ON CONFLICT (team_id, integration_id) DO NOTHING;

-- Step 3: drop the redundant team-scoped rows.
DELETE FROM integrations
WHERE team_id IS NOT NULL;

-- Sanity: every old team_id should now have at least one link.
-- (Commented out — uncomment if you want a hard fail when something
-- slipped through.)
-- DO $$
-- DECLARE
--   leftover_count int;
-- BEGIN
--   SELECT count(*) INTO leftover_count FROM integrations WHERE team_id IS NOT NULL;
--   IF leftover_count > 0 THEN
--     RAISE EXCEPTION 'Backfill incomplete: % team-scope rows remain', leftover_count;
--   END IF;
-- END $$;

COMMIT;
