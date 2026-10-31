ALTER TABLE monitored_resource_config ADD COLUMN agent_monitoring JSONB NOT NULL DEFAULT '{}', ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE monitored_resource_config ADD CONSTRAINT resource_agent_monitoring_check CHECK (jsonb_typeof(agent_monitoring)='object' AND (agent_monitoring='{}' OR resource_type='host'));
ALTER TABLE signal_service ADD COLUMN card_metrics JSONB NOT NULL DEFAULT '["cpu","memory"]' CHECK(card_metrics IN ('["cpu","memory"]'::jsonb,'["cpu","disk"]'::jsonb,'["disk","memory"]'::jsonb));
ALTER TABLE notification_event ADD COLUMN metric_context JSONB CHECK(metric_context IS NULL OR jsonb_typeof(metric_context)='object');
ALTER TABLE notification_event DROP CONSTRAINT notification_event_event_type_check;
ALTER TABLE notification_event ADD CONSTRAINT notification_event_event_type_check CHECK(event_type IN ('unavailable','attention','problem','recovery','usage'));
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
  AND (NOT "presentation" ? 'cardMetrics' OR ("resource_type"='host' AND "presentation"->'cardMetrics' IN ('["cpu","memory"]'::jsonb,'["cpu","disk"]'::jsonb,'["disk","memory"]'::jsonb)))
  AND (COALESCE("presentation"->>'showHealthTimeline', 'false') <> 'true' OR COALESCE("presentation"->>'showHealth', 'false') = 'true')
);

CREATE FUNCTION pulse_resource_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.revision := OLD.revision+1; RETURN NEW; END $$;
CREATE TRIGGER resource_revision BEFORE UPDATE ON monitored_resource_config FOR EACH ROW EXECUTE FUNCTION pulse_resource_revision();
CREATE FUNCTION pulse_usage_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE metric TEXT; ref TEXT; changed BOOLEAN := false; rev BIGINT;
BEGIN
 ref := 'resource:'||NEW.id;
 FOR metric IN SELECT unnest(ARRAY['cpu','memory','disk']) LOOP
  IF OLD.agent_monitoring->'vmBinding' IS DISTINCT FROM NEW.agent_monitoring->'vmBinding'
    OR OLD.agent_monitoring->'thresholds'->metric IS DISTINCT FROM NEW.agent_monitoring->'thresholds'->metric
    OR (metric='disk' AND OLD.agent_monitoring->'capacity' IS DISTINCT FROM NEW.agent_monitoring->'capacity') THEN
   PERFORM 1 FROM notification_target_state WHERE target_ref=ref AND condition_key='metric:'||metric FOR UPDATE;
   DELETE FROM notification_target_state WHERE target_ref=ref AND condition_key='metric:'||metric;
   UPDATE notification_incident SET status='cancelled',closed_at=clock_timestamp(),changed_at=clock_timestamp(),message_code='monitor_changed' WHERE target_ref=ref AND condition_key='metric:'||metric AND status='active';
   changed := true;
  END IF;
 END LOOP;
 IF changed THEN
  UPDATE notification_stream_state SET revision=revision+1,delivery_revision=delivery_revision+1 WHERE id=1 RETURNING revision INTO rev;
  UPDATE notification_incident SET revision=rev WHERE target_ref=ref AND condition_key LIKE 'metric:%' AND changed_at>=transaction_timestamp();
  INSERT INTO notification_change(revision,kind,payload) VALUES(rev,'policy_changed',jsonb_build_object('targetRef',ref));
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER notification_resource_usage AFTER UPDATE ON monitored_resource_config FOR EACH ROW EXECUTE FUNCTION pulse_usage_configuration();
