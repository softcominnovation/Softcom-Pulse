-- Raw SQL and Prisma inserts share the same database-generated UUIDs.
BEGIN;

ALTER TABLE "external_service" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "standalone_vps" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "vps_stack" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "signal_service" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

COMMIT;
