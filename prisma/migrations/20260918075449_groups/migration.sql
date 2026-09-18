-- Groups: team-admin-created subsets with member-scoped run visibility.
-- Table names are mapped to unreserved lowercase (groups/group_members).
ALTER TABLE "Run" ADD COLUMN "groupId" TEXT;

CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "groups_orgId_slug_key" ON "groups"("orgId", "slug");
CREATE INDEX "groups_orgId_idx" ON "groups"("orgId");

CREATE TABLE "group_members" (
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("groupId", "userId")
);

CREATE INDEX "group_members_userId_idx" ON "group_members"("userId");

CREATE INDEX "Run_groupId_idx" ON "Run"("groupId");

ALTER TABLE "groups" ADD CONSTRAINT "groups_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "groups" ADD CONSTRAINT "groups_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Run" ADD CONSTRAINT "Run_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
