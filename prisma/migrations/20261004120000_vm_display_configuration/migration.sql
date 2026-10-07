CREATE TABLE "vm_display_config" (
  "vm_key" VARCHAR(35) PRIMARY KEY,
  "host_key" VARCHAR(256) NOT NULL,
  "vm_id" VARCHAR(64) NOT NULL,
  "virtualization_type" VARCHAR(8) NOT NULL,
  "original_name" VARCHAR(512) NOT NULL,
  "display_name" VARCHAR(120),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_display_config_identity_check" CHECK (
    "vm_key" ~ '^vm-[a-f0-9]{32}$' AND length(btrim("host_key")) > 0 AND
    "host_key" = btrim("host_key") AND "vm_id" ~ '^[0-9]+$' AND
    "virtualization_type" IN ('qemu', 'lxc') AND length("original_name") > 0
  ),
  CONSTRAINT "vm_display_config_metadata_check" CHECK (
    "revision" > 0 AND ("display_name" IS NULL OR
    (length(btrim("display_name")) > 0 AND "display_name" = btrim("display_name") AND "display_name" !~ '[[:cntrl:]]'))
  )
);
CREATE UNIQUE INDEX "vm_display_config_host_key_virtualization_type_vm_id_key"
ON "vm_display_config"("host_key", "virtualization_type", "vm_id");
