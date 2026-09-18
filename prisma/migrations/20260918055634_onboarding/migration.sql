-- Onboarding support (docs/prd-onboarding.md):
--   User.name display name ("" backfills pre-existing rows),
--   GlobalSettings singleton owning the one-way onboarding kill-switch.
ALTER TABLE "User" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';

CREATE TABLE "GlobalSettings" (
    "id" TEXT NOT NULL,
    "onboardingDisabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GlobalSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "GlobalSettings" ("id") VALUES ('global');
