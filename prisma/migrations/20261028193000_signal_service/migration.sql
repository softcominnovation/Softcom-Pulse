CREATE TABLE signal_service (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id UUID NOT NULL REFERENCES signal_target(id) ON DELETE CASCADE,
  display_name VARCHAR(120) NOT NULL,
  service_prefix VARCHAR(200) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  dashboard_enabled BOOLEAN NOT NULL DEFAULT false,
  panel_enabled BOOLEAN NOT NULL DEFAULT true,
  flow_kpi VARCHAR(16),
  critical BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT signal_service_prefix_check CHECK (
    char_length(btrim(service_prefix)) BETWEEN 1 AND 200
    AND left(service_prefix, 1) <> '/'
    AND right(service_prefix, 1) <> '.'
    AND service_prefix !~ '\.[[:digit:]]+\.[A-Za-z0-9]+$'
  ),
  CONSTRAINT signal_service_flow_kpi_check CHECK (flow_kpi IS NULL OR flow_kpi IN ('database', 'redis')),
  CONSTRAINT signal_service_order_check CHECK (display_order >= 0)
);
CREATE UNIQUE INDEX signal_service_target_prefix_key ON signal_service(target_id, service_prefix);
CREATE UNIQUE INDEX signal_service_database_kpi ON signal_service(target_id) WHERE flow_kpi = 'database';
CREATE UNIQUE INDEX signal_service_redis_kpi ON signal_service(target_id) WHERE flow_kpi = 'redis';
CREATE INDEX signal_service_target_order_idx ON signal_service(target_id, display_order, id);

CREATE FUNCTION pulse_signal_service_invalidate(target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE svc RECORD; ref TEXT; rev BIGINT;
BEGIN
  FOR svc IN SELECT id FROM signal_service WHERE target_id = target LOOP
    ref := 'signal_service:' || svc.id;
    INSERT INTO notification_target_state(target_ref, condition_key) VALUES(ref, '$lifecycle') ON CONFLICT DO NOTHING;
    PERFORM 1 FROM notification_target_state WHERE target_ref = ref ORDER BY condition_key FOR UPDATE;
    UPDATE notification_target_state SET epoch = gen_random_uuid(), checkpoint = '{}', updated_at = clock_timestamp() WHERE target_ref = ref AND condition_key = '$lifecycle';
    DELETE FROM notification_target_state WHERE target_ref = ref AND condition_key <> '$lifecycle';
    UPDATE notification_incident SET status = 'cancelled', closed_at = clock_timestamp(), changed_at = clock_timestamp(), message_code = 'monitor_changed' WHERE target_ref = ref AND status = 'active';
    UPDATE notification_stream_state SET revision = revision + 1, delivery_revision = delivery_revision + 1 WHERE id = 1 RETURNING revision INTO rev;
    UPDATE notification_incident SET revision = rev WHERE target_ref = ref AND changed_at >= transaction_timestamp();
    INSERT INTO notification_change(revision, kind, payload) VALUES(rev, 'policy_changed', jsonb_build_object('targetRef', ref));
  END LOOP;
END $$;

CREATE FUNCTION pulse_signal_scope_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid UUID;
BEGIN
  IF TG_TABLE_NAME = 'signal_target' THEN
    IF TG_OP = 'UPDATE' AND OLD.enabled IS NOT DISTINCT FROM NEW.enabled THEN RETURN NULL; END IF;
    tid := COALESCE(NEW.id, OLD.id);
  ELSE
    IF TG_OP = 'UPDATE' AND OLD.host_key IS NOT DISTINCT FROM NEW.host_key AND OLD.vm_key IS NOT DISTINCT FROM NEW.vm_key AND OLD.parent_host_key IS NOT DISTINCT FROM NEW.parent_host_key THEN
      RETURN NULL;
    END IF;
    tid := COALESCE(NEW.target_id, OLD.target_id);
  END IF;
  PERFORM pulse_signal_service_invalidate(tid);
  RETURN NULL;
END $$;

CREATE TRIGGER notification_signal_service_lifecycle AFTER INSERT OR UPDATE OR DELETE ON signal_service
  FOR EACH ROW EXECUTE FUNCTION pulse_notification_lifecycle('signal_service', 'enabled,service_prefix');
CREATE TRIGGER notification_signal_target_scope AFTER UPDATE OF enabled OR DELETE ON signal_target
  FOR EACH ROW EXECUTE FUNCTION pulse_signal_scope_lifecycle();
CREATE TRIGGER notification_signal_link_scope AFTER INSERT OR UPDATE OR DELETE ON signal_infra_link
  FOR EACH ROW EXECUTE FUNCTION pulse_signal_scope_lifecycle();
