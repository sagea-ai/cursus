-- CreateEnum
CREATE TYPE "SweepMethod" AS ENUM ('GRID', 'RANDOM');

-- CreateEnum
CREATE TYPE "SweepState" AS ENUM ('RUNNING', 'FINISHED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "sweepId" TEXT;

-- CreateTable
CREATE TABLE "Sweep" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "method" "SweepMethod" NOT NULL,
    "space" JSONB NOT NULL,
    "state" "SweepState" NOT NULL DEFAULT 'RUNNING',
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sweep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sweep_projectId_idx" ON "Sweep"("projectId");

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_sweepId_fkey" FOREIGN KEY ("sweepId") REFERENCES "Sweep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sweep" ADD CONSTRAINT "Sweep_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sweep" ADD CONSTRAINT "Sweep_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
