-- Prefer Signal · fluxo on screen 1 where problems sat; move problems to screen 2 when room allows.
-- Idempotent: documents that already contain signal_flow are untouched.
BEGIN;
SELECT pg_advisory_xact_lock(734021003::bigint);

WITH candidates AS (
  SELECT
    key,
    value,
    value -> 'screens' AS screens,
    jsonb_array_length(value -> 'screens') AS screen_count,
    value -> 'screens' -> 0 -> 'blocks' AS blocks0
  FROM pulse_settings
  WHERE key = 'dashboardPresentation'
    AND COALESCE((value ->> 'schemaVersion')::int, 1) = 2
    AND jsonb_typeof(value -> 'screens') = 'array'
    AND jsonb_array_length(value -> 'screens') >= 1
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(value -> 'screens') AS screen,
           jsonb_array_elements(COALESCE(screen -> 'blocks', '[]'::jsonb)) AS block
      WHERE block ->> 'type' = 'signal_flow'
    )
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(value -> 'screens' -> 0 -> 'blocks') AS block
      WHERE block ->> 'type' = 'problems' AND COALESCE(block ->> 'enabled', 'true') = 'true'
    )
),
prepared AS (
  SELECT
    c.key,
    c.value,
    c.screens,
    c.screen_count,
    c.blocks0,
    p.ord AS problems_ord,
    p.block AS problems_block,
    CASE WHEN p.block ->> 'width' = 'full' THEN 'full' ELSE 'wide' END AS signal_width,
    gen_random_uuid()::text AS signal_id,
    gen_random_uuid()::text AS screen2_id
  FROM candidates c
  CROSS JOIN LATERAL (
    SELECT block, ordinality AS ord
    FROM jsonb_array_elements(c.blocks0) WITH ORDINALITY AS t(block, ordinality)
    WHERE block ->> 'type' = 'problems' AND COALESCE(block ->> 'enabled', 'true') = 'true'
    ORDER BY ordinality
    LIMIT 1
  ) AS p
),
rewritten AS (
  SELECT
    key,
    value,
    screen_count,
    problems_block,
    signal_width,
    signal_id,
    screen2_id,
    (
      SELECT jsonb_agg(item ORDER BY sort_key)
      FROM (
        SELECT block AS item, ordinality::numeric AS sort_key
        FROM jsonb_array_elements(blocks0) WITH ORDINALITY AS t(block, ordinality)
        WHERE ordinality <> problems_ord
        UNION ALL
        SELECT jsonb_build_object(
          'id', signal_id,
          'type', 'signal_flow',
          'enabled', true,
          'width', signal_width,
          'options', jsonb_build_object('visibleRows', 4)
        ), problems_ord - 0.5
      ) AS parts(item, sort_key)
    ) AS new_blocks0,
    (
      SELECT jsonb_agg(item ORDER BY sort_key)
      FROM (
        SELECT block AS item, ordinality::numeric AS sort_key
        FROM jsonb_array_elements(blocks0) WITH ORDINALITY AS t(block, ordinality)
        UNION ALL
        SELECT jsonb_build_object(
          'id', signal_id,
          'type', 'signal_flow',
          'enabled', true,
          'width', signal_width,
          'options', jsonb_build_object('visibleRows', 4)
        ), problems_ord + 0.5
      ) AS parts(item, sort_key)
    ) AS new_blocks0_keep_problems
  FROM prepared
),
final AS (
  SELECT
    key,
    CASE
      WHEN screen_count = 1 THEN
        jsonb_set(
          jsonb_set(
            value,
            '{screens}',
            jsonb_build_array(
              jsonb_set(value -> 'screens' -> 0, '{blocks}', new_blocks0),
              jsonb_build_object(
                'id', screen2_id,
                'name', 'Problemas',
                'enabled', true,
                'layout', 'overview',
                'blocks', jsonb_build_array(problems_block)
              )
            )
          ),
          '{revision}',
          to_jsonb((value ->> 'revision')::bigint + 1)
        )
      WHEN screen_count = 2 THEN
        jsonb_set(
          jsonb_set(
            jsonb_set(
              value,
              '{screens,0,blocks}',
              new_blocks0
            ),
            '{screens,1,blocks}',
            COALESCE(value -> 'screens' -> 1 -> 'blocks', '[]'::jsonb) || jsonb_build_array(problems_block)
          ),
          '{revision}',
          to_jsonb((value ->> 'revision')::bigint + 1)
        )
      ELSE
        jsonb_set(
          jsonb_set(value, '{screens,0,blocks}', new_blocks0_keep_problems),
          '{revision}',
          to_jsonb((value ->> 'revision')::bigint + 1)
        )
    END AS next_value
  FROM rewritten
)
UPDATE pulse_settings AS settings
SET value = final.next_value, updated_at = CURRENT_TIMESTAMP
FROM final
WHERE settings.key = final.key;

COMMIT;
