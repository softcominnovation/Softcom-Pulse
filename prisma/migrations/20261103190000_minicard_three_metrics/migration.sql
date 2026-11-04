-- Presentation only: retain existing identities, capacity, revisions and alert settings.
ALTER TABLE "monitored_resource_config" DROP CONSTRAINT "resource_presentation_check";

ALTER TABLE "monitored_resource_config" ADD CONSTRAINT "resource_presentation_check" CHECK (
  jsonb_typeof("presentation") = 'object'
  AND ("presentation" - ARRAY['showStatus','showCpu','showMemory','showDisk','showNetwork','showUptime','showHealth','showHealthTimeline','healthTimelineRange','metricsSource','cardMetrics']) = '{}'::jsonb
  AND (NOT "presentation" ? 'showStatus' OR jsonb_typeof("presentation"->'showStatus') = 'boolean')
  AND (NOT "presentation" ? 'showCpu' OR jsonb_typeof("presentation"->'showCpu') = 'boolean')
  AND (NOT "presentation" ? 'showMemory' OR jsonb_typeof("presentation"->'showMemory') = 'boolean')
  AND (NOT "presentation" ? 'showDisk' OR jsonb_typeof("presentation"->'showDisk') = 'boolean')
  AND (NOT "presentation" ? 'showNetwork' OR jsonb_typeof("presentation"->'showNetwork') = 'boolean')
  AND (NOT "presentation" ? 'showUptime' OR jsonb_typeof("presentation"->'showUptime') = 'boolean')
  AND (NOT "presentation" ? 'showHealth' OR jsonb_typeof("presentation"->'showHealth') = 'boolean')
  AND (NOT "presentation" ? 'showHealthTimeline' OR jsonb_typeof("presentation"->'showHealthTimeline') = 'boolean')
  AND (NOT "presentation" ? 'healthTimelineRange' OR ("presentation"->>'healthTimelineRange' IN ('1h','24h','7d') AND jsonb_typeof("presentation"->'healthTimelineRange') = 'string'))
  AND (NOT "presentation" ? 'metricsSource' OR ("presentation"->>'metricsSource' IN ('auto','agent','hypervisor') AND jsonb_typeof("presentation"->'metricsSource') = 'string'))
  AND ("resource_type" <> 'host' OR NOT ("presentation" ?| ARRAY['showHealth','showHealthTimeline','healthTimelineRange']))
  AND ("resource_type" <> 'docker_container' OR NOT ("presentation" ? 'metricsSource'))
  AND (NOT "presentation" ? 'cardMetrics' OR ("resource_type"='host' AND "presentation"->'cardMetrics' IN ('["cpu","memory"]'::jsonb,'["cpu","disk"]'::jsonb,'["disk","memory"]'::jsonb,'["cpu","memory","disk"]'::jsonb)))
  AND (COALESCE("presentation"->>'showHealthTimeline', 'false') <> 'true' OR COALESCE("presentation"->>'showHealth', 'false') = 'true')
);

ALTER TABLE signal_service DROP CONSTRAINT signal_service_card_metrics_check;
ALTER TABLE signal_service ADD CONSTRAINT signal_service_card_metrics_check CHECK(card_metrics IN ('["cpu","memory"]'::jsonb,'["cpu","disk"]'::jsonb,'["disk","memory"]'::jsonb,'["cpu","memory","disk"]'::jsonb));
ALTER TABLE storage_config ADD COLUMN card_metrics JSONB NOT NULL DEFAULT '["cpu","disk"]';
ALTER TABLE storage_config ADD CONSTRAINT storage_card_metrics_check CHECK(card_metrics IN ('["cpu","memory"]'::jsonb,'["cpu","disk"]'::jsonb,'["disk","memory"]'::jsonb,'["cpu","memory","disk"]'::jsonb));
ALTER TABLE standalone_vps ADD COLUMN card_metrics JSONB;
ALTER TABLE standalone_vps ADD CONSTRAINT vps_card_metrics_check CHECK(card_metrics IS NULL OR card_metrics IN ('["cpu","memory"]'::jsonb,'["cpu","disk"]'::jsonb,'["disk","memory"]'::jsonb,'["cpu","memory","disk"]'::jsonb));
