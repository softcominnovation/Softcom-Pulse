-- Softcom Signal monitor targets, infra links and samples (phase 01).

CREATE TABLE "signal_target" (
    "id" UUID NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(240),
    "base_url" VARCHAR(2048) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "dashboard_enabled" BOOLEAN NOT NULL DEFAULT false,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "timeout_ms" INTEGER NOT NULL DEFAULT 5000,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "signal_target_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "signal_infra_link" (
    "id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "label" VARCHAR(80),
    "host_key" VARCHAR(256) NOT NULL,
    "vm_key" VARCHAR(35),
    "parent_host_key" VARCHAR(256),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "signal_infra_link_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "signal_monitor_sample" (
    "id" BIGSERIAL NOT NULL,
    "target_id" UUID NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL,
    "state" SMALLINT NOT NULL,
    "latency_ms" INTEGER,
    "http_status" SMALLINT,
    "live_ok" BOOLEAN,
    "ready_status" VARCHAR(16),
    "worker_status" VARCHAR(32),
    "active_instances" INTEGER,
    "outbox_pending" INTEGER,
    "inbox_pending" INTEGER,
    "outbox_dead" INTEGER,
    "inbox_dead" INTEGER,
    "oldest_outbox_seconds" DOUBLE PRECISION,
    "oldest_inbox_seconds" DOUBLE PRECISION,
    "checks_json" JSONB,
    CONSTRAINT "signal_monitor_sample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "signal_target_display_order_id_idx" ON "signal_target"("display_order", "id");
CREATE INDEX "signal_infra_link_target_id_id_idx" ON "signal_infra_link"("target_id", "id");
CREATE UNIQUE INDEX "signal_infra_link_target_host_vm_key" ON "signal_infra_link"("target_id", "host_key", COALESCE("vm_key", ''));
CREATE INDEX "signal_monitor_sample_target_id_checked_at_idx" ON "signal_monitor_sample"("target_id", "checked_at");

ALTER TABLE "signal_infra_link" ADD CONSTRAINT "signal_infra_link_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "signal_target"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "signal_monitor_sample" ADD CONSTRAINT "signal_monitor_sample_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "signal_target"("id") ON DELETE CASCADE ON UPDATE CASCADE;
