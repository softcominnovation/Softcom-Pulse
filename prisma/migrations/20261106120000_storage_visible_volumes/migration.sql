-- Display selection is independent of monitored capacity and disk alerts.
-- NULL preserves the previous behavior: show every discovered volume.
ALTER TABLE "storage_config" ADD COLUMN "visible_filesystem_keys" JSONB;
