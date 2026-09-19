-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'COMPLETED');

-- DropIndex
DROP INDEX "Run_createdById_idx";

-- CreateTable
CREATE TABLE "MediaItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaItem_runId_status_step_idx" ON "MediaItem"("runId", "status", "step");

-- CreateIndex
CREATE UNIQUE INDEX "MediaItem_runId_key_step_key" ON "MediaItem"("runId", "key", "step");

-- AddForeignKey
ALTER TABLE "MediaItem" ADD CONSTRAINT "MediaItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
