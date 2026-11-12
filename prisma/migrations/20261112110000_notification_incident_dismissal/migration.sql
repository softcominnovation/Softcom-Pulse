ALTER TABLE notification_incident
  ADD COLUMN dismissed_at TIMESTAMPTZ(3),
  ADD COLUMN diagnostic JSONB;
