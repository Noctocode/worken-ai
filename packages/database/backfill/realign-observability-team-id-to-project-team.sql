-- Re-tag historical observability_events.team_id with the
-- *project's* team rather than the user's primary team.
--
-- Background: chat.controller used to call
-- observabilityService.getPrimaryTeamId(user.id) to populate team_id
-- on every chat event, regardless of which project (and therefore
-- which team) the chat actually lived under. For single-team users
-- this happened to round-trip; for anyone in two or more teams the
-- tag and the team that paid for the call diverged silently:
--
--   * Per-team observability rollups attributed spend to the wrong team.
--   * The new per-member cap gate (commit feat/team-byok-per-user-caps)
--     sums by observability_events.team_id, so caps for the chat's
--     actual team would silently miscount on historical data.
--
-- Going forward, chat.controller derives team_id from
-- conversations.project.team_id (matches chat-transport's BYOK
-- lookup + the cap gate). This script realigns the historical data
-- so dashboards + caps see the same team boundary across the entire
-- dataset.
--
-- Scope: only chat_call events with a recoverable conversationId in
-- their metadata. Other event types already tagged correctly:
--   * arena_call / arena_attachment_ocr / evaluator_call all use the
--     explicit teamId from the compare-models composer
--   * tender_*, guardrail_trigger etc. don't go through the chat path
--
-- Idempotent — re-running is a no-op once the team_id matches.
--
-- Usage:
--   docker exec -i worken-postgres psql -U worken -d worken \
--     < packages/database/backfill/realign-observability-team-id-to-project-team.sql
--
-- Recommended after the team-byok PR merges if multi-team users
-- exist; safe to skip on single-team workspaces.

BEGIN;

-- 1. Realign chat_call events whose recovered team is different
--    from what's currently stored. A null project.team_id (personal
--    project) sets observability.team_id back to NULL — matches
--    what chat.controller now writes for personal chats.
WITH recovered AS (
  SELECT
    oe.id AS event_id,
    p.team_id AS correct_team_id
  FROM observability_events oe
  JOIN conversations c
    ON c.id = (oe.metadata ->> 'conversationId')::uuid
  JOIN projects p
    ON p.id = c.project_id
  WHERE oe.event_type = 'chat_call'
    AND oe.metadata ? 'conversationId'
    -- Skip rows already aligned (idempotency). Two NULLs need explicit
    -- handling because NULL != NULL in plain comparison.
    AND oe.team_id IS DISTINCT FROM p.team_id
)
UPDATE observability_events oe
SET team_id = recovered.correct_team_id
FROM recovered
WHERE oe.id = recovered.event_id;

-- 2. Surface a small report so the operator knows what landed. Read
--    via psql; not consumed by code.
SELECT
  'realigned'    AS status,
  count(*)::int  AS chat_events_with_conversation_id,
  sum(case when oe.team_id IS NULL then 1 else 0 end)::int AS now_personal,
  sum(case when oe.team_id IS NOT NULL then 1 else 0 end)::int AS now_team_scoped
FROM observability_events oe
WHERE oe.event_type = 'chat_call'
  AND oe.metadata ? 'conversationId';

COMMIT;
