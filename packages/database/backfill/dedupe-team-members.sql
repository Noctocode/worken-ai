-- Dedupe team_members before adding the (team_id, user_id) partial
-- unique index introduced in commit feat/team-byok-per-user-caps.
--
-- The new index in apps/api blocks the same user from holding two
-- rows in the same team — a state we never want, but pre-existing
-- databases may have if a re-invite ever raced and wrote two rows
-- before the existing-row branch landed.
--
-- This script keeps the *most authoritative* row per (team_id,
-- user_id) and deletes the rest:
--   1. Prefer status='accepted' over 'pending' (the joined-in row
--      is the source of truth)
--   2. Within the same status, prefer the oldest createdAt (member
--      keeps their seniority + invite history)
--
-- Idempotent — running it twice with no duplicates is a no-op. Run
-- before drizzle-kit push so the unique index can be created.
--
--   docker exec -i worken-postgres psql -U worken -d worken \
--     < packages/database/backfill/dedupe-team-members.sql

BEGIN;

WITH ranked AS (
  SELECT
    id,
    team_id,
    user_id,
    status,
    created_at,
    -- Rank: accepted before pending, then oldest first
    ROW_NUMBER() OVER (
      PARTITION BY team_id, user_id
      ORDER BY
        CASE WHEN status = 'accepted' THEN 0 ELSE 1 END,
        created_at ASC
    ) AS rn
  FROM team_members
  WHERE user_id IS NOT NULL
)
DELETE FROM team_members
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

COMMIT;
