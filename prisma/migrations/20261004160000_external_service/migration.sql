CREATE TABLE "external_service" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "display_name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(240),
  "service_type" VARCHAR(40),
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "dashboard_enabled" BOOLEAN NOT NULL DEFAULT false,
  "critical" BOOLEAN NOT NULL DEFAULT false,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "method" VARCHAR(8) NOT NULL,
  "url" VARCHAR(2048) NOT NULL,
  "success_mode" VARCHAR(16) NOT NULL,
  "expected_statuses" INTEGER[] NOT NULL DEFAULT ARRAY[200],
  "json_pointer" VARCHAR(80),
  "expected_value" VARCHAR(80),
  "body_template" VARCHAR(2048),
  "auth_mode" VARCHAR(16) NOT NULL,
  "header_name" VARCHAR(40),
  "secret_ciphertext" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_service_identity_check" CHECK (
    "revision" > 0 AND length(btrim("display_name")) > 0 AND "display_name" = btrim("display_name") AND "display_name" !~ '[[:cntrl:]]'
    AND ("description" IS NULL OR ("description" = btrim("description") AND "description" !~ '[[:cntrl:]]'))
    AND ("service_type" IS NULL OR ("service_type" = btrim("service_type") AND "service_type" !~ '[[:cntrl:]]'))
  ),
  CONSTRAINT "external_service_request_check" CHECK (
    "method" IN ('GET', 'HEAD', 'POST') AND "success_mode" IN ('http_status', 'json_match') AND "auth_mode" IN ('none', 'header')
    AND cardinality("expected_statuses") BETWEEN 1 AND 4
    AND "expected_statuses"::text ~ '^\{(2[0-9]{2})(,(2[0-9]{2})){0,3}\}$'
    AND (("success_mode" = 'http_status' AND "json_pointer" IS NULL AND "expected_value" IS NULL) OR ("success_mode" = 'json_match' AND "json_pointer" IS NOT NULL AND "expected_value" IS NOT NULL AND "method" <> 'HEAD'))
    AND ("method" = 'POST' OR "body_template" IS NULL)
    AND (("auth_mode" = 'none' AND "header_name" IS NULL) OR ("auth_mode" = 'header' AND "header_name" IS NOT NULL))
  )
);
CREATE INDEX "external_service_display_order_id_idx" ON "external_service"("display_order", "id");

CREATE TABLE "external_service_sample" (
  "id" BIGSERIAL PRIMARY KEY,
  "service_id" UUID NOT NULL REFERENCES "external_service"("id") ON DELETE CASCADE,
  "checked_at" TIMESTAMPTZ(3) NOT NULL,
  "reason" SMALLINT NOT NULL,
  "latency_ms" INTEGER,
  "http_status" SMALLINT,
  CONSTRAINT "external_service_sample_reason_check" CHECK ("reason" BETWEEN 0 AND 7 AND ("latency_ms" IS NULL OR "latency_ms" >= 0))
);
CREATE INDEX "external_service_sample_service_id_checked_at_idx" ON "external_service_sample"("service_id", "checked_at");
