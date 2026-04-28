-- One-time backfill: seed observability_events from existing arena_runs.
--
-- Idempotent: aborts early if any backfilled event already exists.
-- Re-running after a partial run is safe; no duplicates will be created.
--
-- How to apply:
--   psql "$DATABASE_URL" -f packages/database/backfill/backfill-observability-from-arena-runs.sql
-- Or, against the local docker-compose db:
--   docker exec -i <postgres-container> psql -U worken -d worken \
--     < packages/database/backfill/backfill-observability-from-arena-runs.sql

DO $$
DECLARE
  existing_count int;
  inserted_count int;
BEGIN
  SELECT count(*)
    INTO existing_count
    FROM observability_events
    WHERE metadata @> '{"backfilled": true}'::jsonb;

  IF existing_count > 0 THEN
    RAISE NOTICE
      'Skipping backfill: % event(s) already tagged metadata.backfilled=true. Delete those rows and re-run for a clean slate.',
      existing_count;
    RETURN;
  END IF;

  WITH primary_team AS (
    -- Mirrors getPrimaryTeamId(): oldest accepted membership per user.
    SELECT DISTINCT ON (user_id)
      user_id,
      team_id
    FROM team_members
    WHERE status = 'accepted'
    ORDER BY user_id, created_at ASC
  ),
  unpacked AS (
    SELECT
      r.user_id,
      pt.team_id AS team_id,
      r.id AS arena_run_id,
      r.created_at,
      r.question,
      jsonb_array_elements(r.responses) AS resp
    FROM arena_runs r
    LEFT JOIN primary_team pt ON pt.user_id = r.user_id
  ),
  rows AS (
    SELECT
      user_id,
      team_id,
      arena_run_id,
      created_at,
      question,
      resp ->> 'model' AS model,
      CASE
        WHEN resp ? 'totalTokens' AND jsonb_typeof(resp -> 'totalTokens') = 'number'
          THEN (resp ->> 'totalTokens')::int
        ELSE NULL
      END AS total_tokens,
      CASE
        WHEN resp ? 'totalCost' AND jsonb_typeof(resp -> 'totalCost') = 'number'
          THEN (resp ->> 'totalCost')::numeric
        ELSE NULL
      END AS cost_usd,
      CASE
        WHEN resp ? 'time' AND jsonb_typeof(resp -> 'time') = 'number'
          THEN (resp ->> 'time')::int
        ELSE NULL
      END AS latency_ms
    FROM unpacked
    WHERE resp ? 'model'
  )
  INSERT INTO observability_events (
    user_id, team_id, event_type, model, provider,
    total_tokens, cost_usd, latency_ms,
    success, prompt_preview, metadata, created_at
  )
  SELECT
    user_id,
    team_id,
    'arena_call',
    model,
    -- Coarse provider derivation: take the slug before the first slash.
    -- Mirrors providerFromModel() in observability.service.ts.
    CASE
      WHEN model LIKE '%/%'
        THEN CASE
               WHEN split_part(model, '/', 1) IN (
                 'openai','anthropic','google','meta-llama','mistralai','cohere',
                 'nvidia','arcee-ai','liquid','stepfun','baidu','qwen','deepseek'
               )
               THEN split_part(model, '/', 1)
               ELSE 'openrouter:' || split_part(model, '/', 1)
             END
      ELSE 'unknown'
    END,
    total_tokens,
    cost_usd,
    latency_ms,
    true,
    CASE
      WHEN length(question) > 200 THEN substring(question for 200) || '…'
      ELSE question
    END,
    jsonb_build_object('backfilled', true, 'arenaRunId', arena_run_id),
    created_at
  FROM rows;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RAISE NOTICE 'Backfill complete: inserted % event(s) from arena_runs.', inserted_count;
END $$;
