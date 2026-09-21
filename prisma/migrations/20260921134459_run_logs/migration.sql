-- CreateTable
CREATE TABLE "RunLog" (
    "id" BIGSERIAL NOT NULL,
    "runId" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "step" INTEGER,
    "text" TEXT NOT NULL,
    "wallTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RunLog_runId_id_idx" ON "RunLog"("runId", "id");

-- AddForeignKey
ALTER TABLE "RunLog" ADD CONSTRAINT "RunLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
