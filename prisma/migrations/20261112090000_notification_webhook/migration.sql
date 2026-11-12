ALTER TABLE notification_event ADD COLUMN diagnostic JSONB;
CREATE INDEX notification_webhook_event_idx ON notification_event(created_revision)
  WHERE announce AND critical_at_occurrence AND severity='critical' AND transition IN ('opened','escalated');

CREATE TABLE notification_webhook (
  id INTEGER PRIMARY KEY CHECK (id=1),
  revision INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT false,
  url TEXT,
  secret TEXT,
  generation UUID NOT NULL DEFAULT gen_random_uuid(),
  cursor_revision BIGINT NOT NULL DEFAULT 0,
  CHECK (NOT active OR (url IS NOT NULL AND url <> '' AND secret IS NOT NULL AND secret <> ''))
);
INSERT INTO notification_webhook(id) VALUES(1);

CREATE TABLE notification_webhook_delivery (
  event_id UUID PRIMARY KEY,
  incident_id UUID NOT NULL,
  generation UUID NOT NULL,
  body JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  due_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  lease UUID,
  finished_at TIMESTAMPTZ(3),
  outcome TEXT
);
CREATE INDEX notification_webhook_due_idx ON notification_webhook_delivery(generation,due_at) WHERE finished_at IS NULL;
CREATE INDEX notification_webhook_finished_idx ON notification_webhook_delivery(finished_at) WHERE finished_at IS NOT NULL;
