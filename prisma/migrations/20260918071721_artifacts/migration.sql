-- Artifacts v1 (run-attached versioned files; no registry/alias/lineage tables).
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'model',
    "description" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Artifact_projectId_name_key" ON "Artifact"("projectId", "name");
CREATE INDEX "Artifact_projectId_idx" ON "Artifact"("projectId");

CREATE TABLE "ArtifactVersion" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "digest" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "fileCount" INTEGER NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdByRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtifactVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArtifactVersion_artifactId_version_key" ON "ArtifactVersion"("artifactId", "version");
CREATE INDEX "ArtifactVersion_artifactId_idx" ON "ArtifactVersion"("artifactId");
CREATE INDEX "ArtifactVersion_createdByRunId_idx" ON "ArtifactVersion"("createdByRunId");

CREATE TABLE "ArtifactFile" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "digest" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "ArtifactFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArtifactFile_versionId_path_key" ON "ArtifactFile"("versionId", "path");
CREATE INDEX "ArtifactFile_versionId_idx" ON "ArtifactFile"("versionId");

-- Foreign keys (match schema onDelete behavior).
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ArtifactVersion" ADD CONSTRAINT "ArtifactVersion_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtifactVersion" ADD CONSTRAINT "ArtifactVersion_createdByRunId_fkey" FOREIGN KEY ("createdByRunId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ArtifactFile" ADD CONSTRAINT "ArtifactFile_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ArtifactVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
