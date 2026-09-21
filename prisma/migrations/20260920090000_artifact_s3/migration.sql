-- AlterTable: two-phase S3 uploads. Existing versions are all complete
-- with inline bytes, so backfill them as COMPLETED with NULL storage keys.
ALTER TABLE "ArtifactVersion" ADD COLUMN "status" "MediaStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "ArtifactFile" ADD COLUMN "storageKey" TEXT;
ALTER TABLE "ArtifactFile" ALTER COLUMN "data" DROP NOT NULL;
UPDATE "ArtifactVersion" SET "status" = 'COMPLETED';
