CREATE TABLE "storage_config" (
    "id" UUID NOT NULL,
    "storage_key" VARCHAR(40) NOT NULL,
    "zabbix_host_id" VARCHAR(64) NOT NULL,
    "original_name" VARCHAR(512) NOT NULL,
    "display_name" VARCHAR(120),
    "description" VARCHAR(240),
    "dashboard_enabled" BOOLEAN NOT NULL DEFAULT false,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "filesystem_keys" JSONB,
    "independent_volumes_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "network_interface_key" VARCHAR(40),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "storage_config_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "storage_identity_check" CHECK (storage_key ~ '^storage-[a-f0-9]{32}$' AND zabbix_host_id ~ '^[0-9]+$'),
    CONSTRAINT "storage_order_check" CHECK (display_order BETWEEN 0 AND 100000 AND revision > 0),
    CONSTRAINT "storage_volumes_check" CHECK (filesystem_keys IS NULL OR (jsonb_typeof(filesystem_keys) = 'array' AND jsonb_array_length(filesystem_keys) BETWEEN 1 AND 32 AND (jsonb_array_length(filesystem_keys) = 1 OR independent_volumes_confirmed)))
);
CREATE UNIQUE INDEX "storage_config_storage_key_key" ON "storage_config"("storage_key");
CREATE UNIQUE INDEX "storage_config_zabbix_host_id_key" ON "storage_config"("zabbix_host_id");
CREATE INDEX "storage_config_display_order_id_idx" ON "storage_config"("display_order", "id");
