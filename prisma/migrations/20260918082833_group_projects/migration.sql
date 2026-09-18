-- Groups own projects (corrected model): visibility is inherited from the
-- project, not tagged per run. Drops Run.groupId; adds Project.groupId with
-- ungroup-on-delete (SetNull), mirroring the earlier run-level semantics.
ALTER TABLE "Run" DROP COLUMN "groupId";

ALTER TABLE "Project" ADD COLUMN "groupId" TEXT;
CREATE INDEX "Project_groupId_idx" ON "Project"("groupId");
ALTER TABLE "Project" ADD CONSTRAINT "Project_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
