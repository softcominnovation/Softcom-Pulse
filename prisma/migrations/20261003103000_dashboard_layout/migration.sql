BEGIN;
SELECT pg_advisory_xact_lock(734021003::bigint);

WITH original AS (
  SELECT key, value, value #> '{screens,0,blocks}' AS blocks
  FROM pulse_settings
  WHERE key = 'dashboardPresentation'
    AND value @> '{"schemaVersion":1,"defaultTvMode":false,"rotation":{"autoStart":false,"intervalSeconds":20}}'::jsonb
    AND jsonb_array_length(value -> 'screens') = 1
    AND value #>> '{screens,0,name}' = 'Visão geral'
    AND value #>> '{screens,0,enabled}' = 'true'
    AND value #>> '{screens,0,layout}' = 'overview'
    AND jsonb_array_length(value #> '{screens,0,blocks}') = 4
), unchanged AS (
  SELECT * FROM original
  WHERE blocks -> 0 @> '{"type":"summary","enabled":true,"width":"full"}'::jsonb
    AND blocks -> 1 @> '{"type":"highlighted_resources","enabled":true,"width":"full"}'::jsonb
    AND blocks -> 2 @> '{"type":"problems","enabled":true,"width":"full"}'::jsonb
    AND blocks -> 3 @> '{"type":"asgard_summary","enabled":true,"width":"full"}'::jsonb
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(blocks) AS block WHERE block ? 'resourceConfigId')
)
UPDATE pulse_settings AS settings
SET value = jsonb_set(
      jsonb_set(unchanged.value, '{screens,0,blocks}', jsonb_build_array(
        unchanged.blocks -> 0,
        unchanged.blocks -> 3,
        jsonb_set(unchanged.blocks -> 2, '{width}', '"wide"'::jsonb),
        jsonb_set(unchanged.blocks -> 1, '{width}', '"standard"'::jsonb)
      )),
      '{revision}', to_jsonb((unchanged.value ->> 'revision')::bigint + 1)
    ), updated_at = CURRENT_TIMESTAMP
FROM unchanged WHERE settings.key = unchanged.key;

COMMIT;
