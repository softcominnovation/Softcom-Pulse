ALTER TABLE "external_service" ADD COLUMN "timeout_ms" INTEGER NOT NULL DEFAULT 5000;
ALTER TABLE "external_service" ADD CONSTRAINT "external_service_timeout_check" CHECK ("timeout_ms" BETWEEN 1000 AND 30000);
