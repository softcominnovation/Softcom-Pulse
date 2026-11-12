-- DropForeignKey
ALTER TABLE "external_service_sample" DROP CONSTRAINT "external_service_sample_service_id_fkey";

-- DropForeignKey
ALTER TABLE "notification_event" DROP CONSTRAINT "notification_event_incident_id_fkey";

-- DropForeignKey
ALTER TABLE "signal_service" DROP CONSTRAINT "signal_service_target_id_fkey";

-- DropForeignKey
ALTER TABLE "vps_monitor_sample" DROP CONSTRAINT "vps_monitor_sample_vps_id_fkey";

-- DropForeignKey
ALTER TABLE "vps_stack" DROP CONSTRAINT "vps_stack_vps_id_fkey";

-- AlterTable
ALTER TABLE "external_service" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "signal_service" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "standalone_vps" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "vps_stack" ALTER COLUMN "id" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "external_service_sample" ADD CONSTRAINT "external_service_sample_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "external_service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "notification_incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vps_stack" ADD CONSTRAINT "vps_stack_vps_id_fkey" FOREIGN KEY ("vps_id") REFERENCES "standalone_vps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vps_monitor_sample" ADD CONSTRAINT "vps_monitor_sample_vps_id_fkey" FOREIGN KEY ("vps_id") REFERENCES "standalone_vps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signal_service" ADD CONSTRAINT "signal_service_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "signal_target"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "signal_service_target_order_idx" RENAME TO "signal_service_target_id_display_order_id_idx";

-- RenameIndex
ALTER INDEX "signal_service_target_prefix_key" RENAME TO "signal_service_target_id_service_prefix_key";
