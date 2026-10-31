ALTER TABLE storage_config ADD COLUMN disk_warning_percent INTEGER;
ALTER TABLE storage_config ADD CONSTRAINT storage_disk_warning_percent_check
 CHECK (disk_warning_percent IS NULL OR (disk_warning_percent BETWEEN 1 AND 100 AND filesystem_keys IS NOT NULL AND jsonb_typeof(filesystem_keys)='array' AND jsonb_array_length(filesystem_keys)>0));

CREATE FUNCTION pulse_storage_disk_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ref TEXT; rev BIGINT;
BEGIN
 IF OLD.disk_warning_percent IS NULL AND NEW.disk_warning_percent IS NULL THEN RETURN NEW; END IF;
 IF OLD.disk_warning_percent IS NOT DISTINCT FROM NEW.disk_warning_percent
   AND (OLD.filesystem_keys IS NOT DISTINCT FROM NEW.filesystem_keys OR (OLD.filesystem_keys @> NEW.filesystem_keys AND NEW.filesystem_keys @> OLD.filesystem_keys))
   AND OLD.independent_volumes_confirmed IS NOT DISTINCT FROM NEW.independent_volumes_confirmed THEN RETURN NEW; END IF;
 ref := 'storage:'||NEW.id;
 -- Lock every existing condition before the stream, also when critical changes
 -- in the same statement and the shared lifecycle trigger runs afterwards.
 PERFORM 1 FROM notification_target_state WHERE target_ref=ref ORDER BY condition_key FOR UPDATE;
 DELETE FROM notification_target_state WHERE target_ref=ref AND condition_key='metric:disk';
 UPDATE notification_incident SET status='cancelled',closed_at=clock_timestamp(),changed_at=clock_timestamp(),message_code='monitor_changed'
  WHERE target_ref=ref AND condition_key='metric:disk' AND status='active';
 UPDATE notification_stream_state SET revision=revision+1,delivery_revision=delivery_revision+1 WHERE id=1 RETURNING revision INTO rev;
 UPDATE notification_incident SET revision=rev WHERE target_ref=ref AND condition_key='metric:disk' AND changed_at>=transaction_timestamp();
 INSERT INTO notification_change(revision,kind,payload) VALUES(rev,'policy_changed',jsonb_build_object('targetRef',ref));
 RETURN NEW;
END $$;
CREATE TRIGGER notification_storage_disk BEFORE UPDATE ON storage_config FOR EACH ROW EXECUTE FUNCTION pulse_storage_disk_configuration();
