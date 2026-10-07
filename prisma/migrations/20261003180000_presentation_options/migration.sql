BEGIN;
SELECT pg_advisory_xact_lock(734021003::bigint);

WITH compatible AS (
  SELECT key, value
  FROM pulse_settings
  WHERE key = 'dashboardPresentation' AND value ->> 'schemaVersion' = '1'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(value -> 'screens') s
      WHERE (SELECT count(*) FROM jsonb_array_elements(s -> 'blocks') b WHERE b ->> 'enabled' = 'true') > 6
    )
), converted AS (
  SELECT key, jsonb_set(value, '{screens}', (
    SELECT jsonb_agg(jsonb_set(s, '{blocks}', (
      SELECT COALESCE(jsonb_agg(b || jsonb_build_object('options', CASE b ->> 'type'
        WHEN 'summary' THEN '{"indicators":["hosts","containers_running","containers_stopped","problems"]}'::jsonb
        WHEN 'asgard_summary' THEN '{"sortBy":"name","sortDirection":"asc","visibleRows":6,"states":["running","stopped","paused","unknown"]}'::jsonb
        WHEN 'problems' THEN '{"sortBy":"severity","sortDirection":"desc","visibleRows":6,"severities":[0,1,2,3,4,5]}'::jsonb
        WHEN 'highlighted_resources' THEN '{"sortBy":"configured","sortDirection":"asc","criticalOnly":false,"visibleRows":1}'::jsonb
        WHEN 'host_inventory' THEN '{"sortBy":"name","sortDirection":"asc","visibleRows":6}'::jsonb
        WHEN 'container_inventory' THEN '{"sortBy":"name","sortDirection":"asc","visibleRows":6}'::jsonb
        ELSE '{}'::jsonb END) ORDER BY bi), '[]'::jsonb)
      FROM jsonb_array_elements(s -> 'blocks') WITH ORDINALITY AS blocks(b, bi)
    )) ORDER BY si)
    FROM jsonb_array_elements(value -> 'screens') WITH ORDINALITY AS screens(s, si)
  )) AS value FROM compatible
)
UPDATE pulse_settings p
SET value = jsonb_set(jsonb_set(c.value, '{schemaVersion}', '2'::jsonb), '{revision}', to_jsonb((c.value ->> 'revision')::bigint + 1)),
    updated_at = CURRENT_TIMESTAMP
FROM converted c WHERE p.key = c.key;

COMMIT;
