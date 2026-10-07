ALTER TABLE "standalone_vps" ADD COLUMN "provider" VARCHAR(120);
ALTER TABLE "standalone_vps" ADD CONSTRAINT "standalone_vps_provider_check" CHECK (
  "provider" IS NULL OR (length(btrim("provider")) > 0 AND "provider" = btrim("provider") AND "provider" !~ '[[:cntrl:]]')
);
