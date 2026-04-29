-- ─── Observability seed ─────────────────────────────────────────────
-- Generates ~30 days of synthetic events spread across all existing
-- users so the /observability dashboard has data to render. Each event
-- carries metadata.seed=true so you can wipe-and-reseed cleanly.
--
-- How to apply:
--   psql "$DATABASE_URL" -f packages/database/seed/seed-observability.sql
--
-- How to reset:
--   psql "$DATABASE_URL" -c "DELETE FROM observability_events WHERE metadata @> '{\"seed\":true}'::jsonb;"
-- Then re-run the file above.
--
-- Quantities (per user, over 30 days):
--   arena_call           ~120
--   evaluator_call       ~30
--   chat_call            ~90
--   arena_attachment_ocr ~15
--   document_title       ~10
--   guardrail_trigger    ~15
-- ≈ 280 events per user. Multiplies by user count.

DO $$
DECLARE
  existing_count int;
  inserted_count int;
BEGIN
  SELECT count(*)
    INTO existing_count
    FROM observability_events
    WHERE metadata @> '{"seed": true}'::jsonb;

  IF existing_count > 0 THEN
    RAISE NOTICE
      'Skipping seed: % event(s) already tagged metadata.seed=true. Run the DELETE in the comment header to reset, then re-run.',
      existing_count;
    RETURN;
  END IF;

  WITH
    -- Pick a primary team per user (oldest accepted membership).
    primary_team AS (
      SELECT DISTINCT ON (user_id)
        user_id,
        team_id
      FROM team_members
      WHERE status = 'accepted'
      ORDER BY user_id, created_at ASC
    ),
    -- Models with realistic cost/token shapes per provider.
    model_pool(model, provider, base_cost, base_tokens, base_latency) AS (
      VALUES
        ('openai/gpt-4o',                                 'openai',     0.01500, 1200, 1800),
        ('openai/gpt-4-turbo',                            'openai',     0.02000, 1500, 2400),
        ('openai/gpt-3.5-turbo',                          'openai',     0.00150,  900,  900),
        ('anthropic/claude-3-5-sonnet',                   'anthropic',  0.01200, 1300, 2100),
        ('anthropic/claude-3-haiku',                      'anthropic',  0.00080,  700,  600),
        ('google/gemini-1.5-pro',                         'google',     0.00750, 1100, 2000),
        ('google/gemini-1.5-flash',                       'google',     0.00040,  800,  500),
        ('nvidia/nemotron-3-super-120b-a12b:free',        'nvidia',     0.00000, 1400, 3200),
        ('arcee-ai/trinity-large-preview:free',           'arcee-ai',   0.00000,  600,  800),
        ('meta-llama/llama-3.1-70b-instruct',             'meta-llama', 0.00400, 1000, 1500),
        ('mistralai/mistral-large',                       'mistralai',  0.00800, 1100, 1700),
        ('liquid/lfm-2.5-1.2b-thinking:free',             'liquid',     0.00000,  500,  450),
        ('baidu/qianfan-ocr-fast:free',                   'baidu',      0.00000,  300,  900),
        ('stepfun/step-3.5-flash:free',                   'stepfun',    0.00000,  900, 1100)
    ),
    -- 30 days × ~10 events/day per user, jittered.
    arena_events AS (
      SELECT
        u.id AS user_id,
        pt.team_id,
        'arena_call' AS event_type,
        m.model,
        m.provider,
        -- ±25% jitter around base
        round((m.base_tokens * (0.75 + random() * 0.5))::numeric)::int AS total_tokens,
        round((m.base_cost * (0.75 + random() * 0.5))::numeric, 6) AS cost_usd,
        round((m.base_latency * (0.7 + random() * 0.6))::numeric)::int AS latency_ms,
        -- 5% failure rate
        random() > 0.05 AS success,
        now()
          - (random() * interval '30 days')
          AS created_at
      FROM users u
      LEFT JOIN primary_team pt ON pt.user_id = u.id
      CROSS JOIN LATERAL (
        SELECT * FROM model_pool ORDER BY random() LIMIT 1
      ) m
      CROSS JOIN generate_series(1, 120) -- 120 arena calls per user
    ),
    evaluator_events AS (
      SELECT
        u.id AS user_id,
        pt.team_id,
        'evaluator_call' AS event_type,
        'nvidia/nemotron-3-super-120b-a12b:free' AS model,
        'nvidia' AS provider,
        NULL::int AS total_tokens,
        NULL::numeric AS cost_usd,
        round((3200 * (0.7 + random() * 0.6))::numeric)::int AS latency_ms,
        random() > 0.03 AS success,
        now() - (random() * interval '30 days') AS created_at
      FROM users u
      LEFT JOIN primary_team pt ON pt.user_id = u.id
      CROSS JOIN generate_series(1, 30)
    ),
    chat_events AS (
      SELECT
        u.id AS user_id,
        pt.team_id,
        'chat_call' AS event_type,
        m.model,
        m.provider,
        round((m.base_tokens * 0.8 * (0.7 + random() * 0.6))::numeric)::int AS total_tokens,
        round((m.base_cost * 0.8 * (0.7 + random() * 0.6))::numeric, 6) AS cost_usd,
        round((m.base_latency * (0.7 + random() * 0.6))::numeric)::int AS latency_ms,
        random() > 0.04 AS success,
        now() - (random() * interval '30 days') AS created_at
      FROM users u
      LEFT JOIN primary_team pt ON pt.user_id = u.id
      CROSS JOIN LATERAL (
        SELECT * FROM model_pool
        WHERE model NOT LIKE 'baidu/%'  -- OCR model excluded from chat
        ORDER BY random()
        LIMIT 1
      ) m
      CROSS JOIN generate_series(1, 90)
    ),
    ocr_events AS (
      SELECT
        u.id AS user_id,
        pt.team_id,
        'arena_attachment_ocr' AS event_type,
        'baidu/qianfan-ocr-fast:free' AS model,
        'baidu' AS provider,
        NULL::int AS total_tokens,
        NULL::numeric AS cost_usd,
        round((900 * (0.6 + random() * 0.8))::numeric)::int AS latency_ms,
        random() > 0.06 AS success,
        now() - (random() * interval '30 days') AS created_at
      FROM users u
      LEFT JOIN primary_team pt ON pt.user_id = u.id
      CROSS JOIN generate_series(1, 15)
    ),
    title_events AS (
      SELECT
        u.id AS user_id,
        pt.team_id,
        'document_title' AS event_type,
        'arcee-ai/trinity-large-preview:free' AS model,
        'arcee-ai' AS provider,
        round((20 + random() * 30)::numeric)::int AS total_tokens,
        0::numeric AS cost_usd,
        round((400 + random() * 800)::numeric)::int AS latency_ms,
        true AS success,
        now() - (random() * interval '30 days') AS created_at
      FROM users u
      LEFT JOIN primary_team pt ON pt.user_id = u.id
      CROSS JOIN generate_series(1, 10)
    ),
    guardrail_events AS (
      SELECT
        u.id AS user_id,
        pt.team_id,
        'guardrail_trigger' AS event_type,
        NULL::text AS model,
        'system' AS provider,
        NULL::int AS total_tokens,
        NULL::numeric AS cost_usd,
        NULL::int AS latency_ms,
        true AS success,
        now() - (random() * interval '30 days') AS created_at,
        g.* AS guardrail
      FROM users u
      LEFT JOIN primary_team pt ON pt.user_id = u.id
      CROSS JOIN LATERAL (
        SELECT
          (ARRAY[
            'PII Filter',
            'Content Safety',
            'Compliance Check',
            'Confidential Data',
            'Toxic Language'
          ])[1 + floor(random() * 5)::int] AS guardrail_name,
          (ARRAY['low','medium','high'])[1 + floor(random() * 3)::int] AS severity
      ) g
      CROSS JOIN generate_series(1, 15)
    ),
    all_events AS (
      SELECT
        user_id, team_id, event_type, model, provider,
        total_tokens, cost_usd, latency_ms, success,
        CASE WHEN success THEN NULL
             ELSE (ARRAY[
               'Rate limit exceeded',
               'Provider returned 502',
               'Context length exceeded',
               'Insufficient credits',
               'Model temporarily unavailable'
             ])[1 + floor(random() * 5)::int]
        END AS error_message,
        (ARRAY[
          'Analyze the attached vendor proposal for completeness',
          'Compare these three RFP responses on technical merit',
          'Extract key compliance terms from the legal contract',
          'Summarize the procurement requirements',
          'Generate a risk assessment for this vendor',
          'Draft response to RFP question 12 about uptime',
          'Review pricing structure and flag any anomalies',
          'Identify gaps between requirements and our capabilities'
        ])[1 + floor(random() * 8)::int] AS prompt_preview,
        jsonb_build_object('seed', true) AS metadata,
        created_at
      FROM arena_events
      UNION ALL
      SELECT user_id, team_id, event_type, model, provider, total_tokens, cost_usd, latency_ms, success,
             CASE WHEN success THEN NULL ELSE 'Evaluator returned malformed JSON' END,
             NULL,
             jsonb_build_object('seed', true, 'attempt', 1),
             created_at
      FROM evaluator_events
      UNION ALL
      SELECT user_id, team_id, event_type, model, provider, total_tokens, cost_usd, latency_ms, success,
             CASE WHEN success THEN NULL ELSE 'Connection reset' END,
             (ARRAY[
               'How do I configure the integration?',
               'Walk me through the deployment process',
               'What are the security implications?',
               'Help me write a follow-up email'
             ])[1 + floor(random() * 4)::int],
             jsonb_build_object('seed', true),
             created_at
      FROM chat_events
      UNION ALL
      SELECT user_id, team_id, event_type, model, provider, total_tokens, cost_usd, latency_ms, success,
             CASE WHEN success THEN NULL ELSE 'OCR could not extract text' END,
             NULL,
             jsonb_build_object('seed', true, 'filename', 'invoice.png'),
             created_at
      FROM ocr_events
      UNION ALL
      SELECT user_id, team_id, event_type, model, provider, total_tokens, cost_usd, latency_ms, success,
             NULL, NULL,
             jsonb_build_object('seed', true, 'phase', 'title-generation'),
             created_at
      FROM title_events
      UNION ALL
      SELECT user_id, team_id, event_type, model, provider, total_tokens, cost_usd, latency_ms, success,
             NULL, NULL,
             jsonb_build_object('seed', true, 'name', guardrail_name, 'severity', severity),
             created_at
      FROM guardrail_events
    )
  INSERT INTO observability_events (
    user_id, team_id, event_type, model, provider,
    total_tokens, cost_usd, latency_ms, success, error_message,
    prompt_preview, metadata, created_at
  )
  SELECT
    user_id, team_id, event_type, model, provider,
    total_tokens, cost_usd, latency_ms, success, error_message,
    prompt_preview, metadata, created_at
  FROM all_events;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RAISE NOTICE 'Seed complete: inserted % event(s).', inserted_count;
END $$;
