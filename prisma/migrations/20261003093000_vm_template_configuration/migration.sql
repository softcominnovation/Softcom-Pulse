CREATE TABLE "vm_template_config" (
    "template_key" VARCHAR(35) NOT NULL,
    "host_key" VARCHAR(256) NOT NULL,
    "template_id" VARCHAR(64) NOT NULL,
    "virtualization_type" VARCHAR(8) NOT NULL,
    "original_name" VARCHAR(512) NOT NULL,
    "display_name" VARCHAR(120),
    "role_override" VARCHAR(16),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vm_template_config_pkey" PRIMARY KEY ("template_key"),
    CONSTRAINT "vm_template_config_identity_check" CHECK (
      "template_key" ~ '^vm-[a-f0-9]{32}$' AND
      length(btrim("host_key")) > 0 AND "host_key" = btrim("host_key") AND
      "template_id" ~ '^[0-9]+$' AND "virtualization_type" IN ('qemu', 'lxc') AND
      left("original_name", 3) = 'tpl'
    ),
    CONSTRAINT "vm_template_config_metadata_check" CHECK (
      ("display_name" IS NULL OR (length(btrim("display_name")) > 0 AND "display_name" = btrim("display_name") AND "display_name" !~ '[[:cntrl:]]')) AND
      ("role_override" IS NULL OR "role_override" IN ('worker', 'manager')) AND "revision" > 0
    )
);
CREATE UNIQUE INDEX "vm_template_config_host_key_virtualization_type_template_id_key"
ON "vm_template_config"("host_key", "virtualization_type", "template_id");
