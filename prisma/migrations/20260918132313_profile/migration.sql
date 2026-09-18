-- Profile fields + run-author index (profile runs/activity at scale).
ALTER TABLE "User" ADD COLUMN "bio" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "location" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "website" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "twitter" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "github" TEXT NOT NULL DEFAULT '';

-- Profile queries filter/order by author; without this the activity and
-- recent-runs reads degrade into scans as run volume grows.
CREATE INDEX "Run_createdById_idx" ON "Run"("createdById");
