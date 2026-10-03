-- CreateTable
CREATE TABLE "monitored_resource_config" (
    "id" UUID NOT NULL,
    "resource_type" VARCHAR(32) NOT NULL,
    "source" VARCHAR(16) NOT NULL DEFAULT 'zabbix',
    "zabbix_host_key" VARCHAR(256) NOT NULL,
    "selector_type" VARCHAR(32),
    "selector_value" VARCHAR(256),
    "display_name" VARCHAR(120),
    "dashboard_enabled" BOOLEAN NOT NULL DEFAULT false,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "presentation" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitored_resource_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pulse_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pulse_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "monitored_resource_config_display_order_id_idx" ON "monitored_resource_config"("display_order", "id");

CREATE UNIQUE INDEX "monitored_resource_host_unique"
ON "monitored_resource_config" ("zabbix_host_key", "resource_type")
WHERE "resource_type" = 'host';

CREATE UNIQUE INDEX "monitored_resource_container_unique"
ON "monitored_resource_config" ("zabbix_host_key", "resource_type", "selector_type", "selector_value")
WHERE "resource_type" = 'docker_container';

ALTER TABLE "monitored_resource_config"
ADD CONSTRAINT "resource_identity_check" CHECK (
  "source" = 'zabbix' AND "display_order" >= 0
  AND length(trim("zabbix_host_key")) > 0 AND "zabbix_host_key" = trim("zabbix_host_key")
  AND "zabbix_host_key" !~ '[[:cntrl:]/\\]'
  AND ("display_name" IS NULL OR length(trim("display_name")) > 0)
  AND (("resource_type" = 'host' AND "selector_type" IS NULL AND "selector_value" IS NULL)
    OR ("resource_type" = 'docker_container' AND "selector_type" IS NOT NULL AND "selector_value" IS NOT NULL
      AND "selector_type" IN ('exact_name', 'name_prefix', 'name_contains', 'regex') AND length("selector_value") > 0))
),
ADD CONSTRAINT "resource_presentation_check" CHECK (
  jsonb_typeof("presentation") = 'object'
  AND ("presentation" - ARRAY['showStatus','showCpu','showMemory','showDisk','showNetwork','showUptime','showHealth','showHealthTimeline','healthTimelineRange']) = '{}'::jsonb
  AND (NOT "presentation" ? 'showStatus' OR jsonb_typeof("presentation"->'showStatus') = 'boolean')
  AND (NOT "presentation" ? 'showCpu' OR jsonb_typeof("presentation"->'showCpu') = 'boolean')
  AND (NOT "presentation" ? 'showMemory' OR jsonb_typeof("presentation"->'showMemory') = 'boolean')
  AND (NOT "presentation" ? 'showDisk' OR jsonb_typeof("presentation"->'showDisk') = 'boolean')
  AND (NOT "presentation" ? 'showNetwork' OR jsonb_typeof("presentation"->'showNetwork') = 'boolean')
  AND (NOT "presentation" ? 'showUptime' OR jsonb_typeof("presentation"->'showUptime') = 'boolean')
  AND (NOT "presentation" ? 'showHealth' OR jsonb_typeof("presentation"->'showHealth') = 'boolean')
  AND (NOT "presentation" ? 'showHealthTimeline' OR jsonb_typeof("presentation"->'showHealthTimeline') = 'boolean')
  AND (NOT "presentation" ? 'healthTimelineRange' OR ("presentation"->>'healthTimelineRange' IN ('1h','24h','7d') AND jsonb_typeof("presentation"->'healthTimelineRange') = 'string'))
  AND ("resource_type" <> 'host' OR NOT ("presentation" ?| ARRAY['showHealth','showHealthTimeline','healthTimelineRange']))
  AND (COALESCE("presentation"->>'showHealthTimeline', 'false') <> 'true' OR COALESCE("presentation"->>'showHealth', 'false') = 'true')
);

