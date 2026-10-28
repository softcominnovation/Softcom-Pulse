ALTER TABLE standalone_vps ADD COLUMN critical BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE notification_target_state (
  target_ref VARCHAR(60) NOT NULL,
  condition_key VARCHAR(256) NOT NULL,
  epoch UUID NOT NULL DEFAULT gen_random_uuid(),
  checkpoint JSONB NOT NULL DEFAULT '{}',
  incident_id UUID,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (target_ref, condition_key)
);
CREATE TABLE notification_incident (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_ref VARCHAR(60) NOT NULL,
  condition_key VARCHAR(256) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  source VARCHAR(16) NOT NULL,
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('info','warning','critical')),
  source_severity SMALLINT CHECK (source_severity BETWEEN 0 AND 5),
  status VARCHAR(16) NOT NULL CHECK (status IN ('active','resolved','cancelled')),
  message_code VARCHAR(40) NOT NULL,
  opened_at TIMESTAMPTZ(3) NOT NULL,
  confirmed_at TIMESTAMPTZ(3) NOT NULL,
  changed_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMPTZ(3),
  revision BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX notification_incident_active_key ON notification_incident(target_ref,condition_key) WHERE status='active';
CREATE INDEX notification_incident_status_idx ON notification_incident(status,changed_at DESC,id);
CREATE TABLE notification_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES notification_incident(id) ON DELETE CASCADE,
  transition_key VARCHAR(180) NOT NULL UNIQUE,
  target_ref VARCHAR(60) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  event_type VARCHAR(16) NOT NULL CHECK (event_type IN ('unavailable','attention','problem','recovery')),
  transition VARCHAR(16) NOT NULL CHECK (transition IN ('opened','escalated','recovered')),
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('info','warning','critical')),
  source_severity SMALLINT CHECK (source_severity BETWEEN 0 AND 5),
  critical_at_occurrence BOOLEAN NOT NULL,
  message_code VARCHAR(40) NOT NULL,
  occurred_at TIMESTAMPTZ(3) NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_revision BIGINT NOT NULL DEFAULT 0,
  revision BIGINT NOT NULL DEFAULT 0,
  announce BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ(3),
  read_by VARCHAR(254)
);
CREATE INDEX notification_event_history_idx ON notification_event(created_at DESC,id DESC);
CREATE INDEX notification_event_unread_idx ON notification_event(created_revision) WHERE read_at IS NULL;
CREATE INDEX notification_event_incident_idx ON notification_event(incident_id,created_at DESC,id);
CREATE TABLE notification_stream_state (
  id INTEGER PRIMARY KEY CHECK (id=1),
  revision BIGINT NOT NULL DEFAULT 0,
  delivery_revision BIGINT NOT NULL DEFAULT 1,
  generation UUID NOT NULL DEFAULT gen_random_uuid(),
  minimum_revision BIGINT NOT NULL DEFAULT 0,
  maintained_at TIMESTAMPTZ(3)
);
INSERT INTO notification_stream_state(id) VALUES(1);
INSERT INTO pulse_settings(key,value) VALUES('notifications','{"schemaVersion":1,"revision":1}') ON CONFLICT DO NOTHING;
CREATE TABLE notification_change (
  revision BIGINT PRIMARY KEY,
  kind VARCHAR(24) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX notification_change_retention_idx ON notification_change(created_at);

-- Configuration and incident cancellation commit together, including deletes and paused monitors.
CREATE FUNCTION pulse_notification_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous JSONB; current_row JSONB; ref TEXT; identity_changed BOOLEAN; relevant BOOLEAN; rev BIGINT;
BEGIN
  previous := CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  current_row := CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  ref := TG_ARGV[0] || ':' || COALESCE(current_row->>'id',previous->>'id');
  identity_changed := TG_OP<>'UPDATE' OR
    (SELECT jsonb_object_agg(key,value) FROM jsonb_each(previous) WHERE key=ANY(string_to_array(TG_ARGV[1],','))) IS DISTINCT FROM
    (SELECT jsonb_object_agg(key,value) FROM jsonb_each(current_row) WHERE key=ANY(string_to_array(TG_ARGV[1],',')));
  relevant := identity_changed OR previous->'critical' IS DISTINCT FROM current_row->'critical';
  IF NOT relevant THEN RETURN NULL; END IF;
  INSERT INTO notification_target_state(target_ref,condition_key) VALUES(ref,'$lifecycle') ON CONFLICT DO NOTHING;
  PERFORM 1 FROM notification_target_state WHERE target_ref=ref ORDER BY condition_key FOR UPDATE;
  IF identity_changed THEN
    UPDATE notification_target_state SET epoch=gen_random_uuid(),checkpoint='{}',updated_at=clock_timestamp() WHERE target_ref=ref AND condition_key='$lifecycle';
    DELETE FROM notification_target_state WHERE target_ref=ref AND condition_key<>'$lifecycle';
    UPDATE notification_incident SET status='cancelled',closed_at=clock_timestamp(),changed_at=clock_timestamp(),message_code='monitor_changed' WHERE target_ref=ref AND status='active';
  END IF;
  UPDATE notification_stream_state SET revision=revision+1,delivery_revision=delivery_revision+1 WHERE id=1 RETURNING revision INTO rev;
  UPDATE notification_incident SET revision=rev WHERE target_ref=ref AND changed_at>=transaction_timestamp();
  INSERT INTO notification_change(revision,kind,payload) VALUES(rev,'policy_changed',jsonb_build_object('targetRef',ref));
  RETURN NULL;
END $$;
CREATE TRIGGER notification_resource_lifecycle AFTER INSERT OR UPDATE OR DELETE ON monitored_resource_config FOR EACH ROW EXECUTE FUNCTION pulse_notification_lifecycle('resource','enabled,resource_type,zabbix_host_key,selector_type,selector_value');
CREATE TRIGGER notification_external_lifecycle AFTER INSERT OR UPDATE OR DELETE ON external_service FOR EACH ROW EXECUTE FUNCTION pulse_notification_lifecycle('external_service','enabled,url,method,success_mode,expected_statuses,json_pointer,expected_value,body_template,auth_mode,header_name,secret_ciphertext,timeout_ms');
CREATE TRIGGER notification_vps_lifecycle AFTER INSERT OR UPDATE OR DELETE ON standalone_vps FOR EACH ROW EXECUTE FUNCTION pulse_notification_lifecycle('standalone_vps','enabled,monitor_paused,base_url,api_key_ciphertext,timeout_ms');
CREATE TRIGGER notification_signal_lifecycle AFTER INSERT OR UPDATE OR DELETE ON signal_target FOR EACH ROW EXECUTE FUNCTION pulse_notification_lifecycle('signal_target','enabled,base_url,timeout_ms');
CREATE TRIGGER notification_storage_lifecycle AFTER INSERT OR UPDATE OR DELETE ON storage_config FOR EACH ROW EXECUTE FUNCTION pulse_notification_lifecycle('storage','zabbix_host_id');
INSERT INTO notification_target_state(target_ref,condition_key)
SELECT 'resource:'||id,'$lifecycle' FROM monitored_resource_config UNION ALL
SELECT 'external_service:'||id,'$lifecycle' FROM external_service UNION ALL
SELECT 'standalone_vps:'||id,'$lifecycle' FROM standalone_vps UNION ALL
SELECT 'signal_target:'||id,'$lifecycle' FROM signal_target UNION ALL
SELECT 'storage:'||id,'$lifecycle' FROM storage_config;
