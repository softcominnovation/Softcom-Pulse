ALTER TABLE "standalone_vps" ADD COLUMN "monitor_paused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "standalone_vps" ADD COLUMN "progress_started_at" TIMESTAMPTZ(3);
