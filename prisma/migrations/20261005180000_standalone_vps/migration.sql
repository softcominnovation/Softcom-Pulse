CREATE TABLE "standalone_vps" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(120) NOT NULL,
  "ip" VARCHAR(45) NOT NULL,
  "domain" VARCHAR(255),
  "manager_url" VARCHAR(2048),
  "base_url" VARCHAR(2048),
  "api_key_ciphertext" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "dashboard_enabled" BOOLEAN NOT NULL DEFAULT false,
  "timeout_ms" INTEGER NOT NULL DEFAULT 5000,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "standalone_vps_identity_check" CHECK (
    "revision" > 0 AND "timeout_ms" BETWEEN 1000 AND 30000
    AND length(btrim("name")) > 0 AND "name" = btrim("name") AND "name" !~ '[[:cntrl:]]'
    AND ("domain" IS NULL OR ("domain" = btrim("domain") AND "domain" !~ '[[:cntrl:]]'))
    AND (("base_url" IS NULL AND "api_key_ciphertext" IS NULL) OR ("base_url" IS NOT NULL AND "api_key_ciphertext" IS NOT NULL))
  )
);
CREATE INDEX "standalone_vps_name_id_idx" ON "standalone_vps"("name", "id");

CREATE TABLE "vps_stack" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "vps_id" UUID NOT NULL REFERENCES "standalone_vps"("id") ON DELETE CASCADE,
  "name" VARCHAR(120) NOT NULL,
  "link" VARCHAR(2048),
  "notes" VARCHAR(2000),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vps_stack_name_check" CHECK (length(btrim("name")) > 0 AND "name" = btrim("name") AND "name" !~ '[[:cntrl:]]')
);
CREATE INDEX "vps_stack_vps_id_name_id_idx" ON "vps_stack"("vps_id", "name", "id");

CREATE TABLE "vps_monitor_sample" (
  "id" BIGSERIAL PRIMARY KEY,
  "vps_id" UUID NOT NULL REFERENCES "standalone_vps"("id") ON DELETE CASCADE,
  "checked_at" TIMESTAMPTZ(3) NOT NULL,
  "reason" SMALLINT NOT NULL,
  "latency_ms" INTEGER,
  "cpu_percent" DECIMAL(6, 2),
  "memory_percent" DECIMAL(6, 2),
  "disk_percent" DECIMAL(6, 2),
  CONSTRAINT "vps_monitor_sample_reason_check" CHECK ("reason" BETWEEN 0 AND 5)
);
CREATE INDEX "vps_monitor_sample_vps_id_checked_at_idx" ON "vps_monitor_sample"("vps_id", "checked_at");
