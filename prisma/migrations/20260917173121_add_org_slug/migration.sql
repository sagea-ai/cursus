-- Add Org.slug for /[org]/... dashboard routes (PRD §7.1).
-- Backfills existing rows from name before enforcing NOT NULL + UNIQUE.
ALTER TABLE "Org" ADD COLUMN "slug" TEXT;

UPDATE "Org"
SET "slug" = NULLIF(
  TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER("name"), '[^a-z0-9]+', '-', 'g')),
  ''
)
WHERE "slug" IS NULL;

UPDATE "Org" SET "slug" = "id" WHERE "slug" IS NULL;

UPDATE "Org" o
SET "slug" = o."slug" || '-' || LEFT(o."id", 6)
WHERE (SELECT COUNT(*) FROM "Org" x WHERE x."slug" = o."slug") > 1;

ALTER TABLE "Org" ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX "Org_slug_key" ON "Org"("slug");
