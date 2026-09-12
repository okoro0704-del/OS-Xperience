-- User My Experience membership (not Directory, not an install database).
CREATE TYPE "ExperienceMembershipStatus" AS ENUM ('ACTIVE', 'PAUSED');
CREATE TABLE "ExperienceSelection" (
  "id" TEXT PRIMARY KEY,
  "participantId" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL REFERENCES "Application"("id"),
  "status" "ExperienceMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "addedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastOpenedAt" TIMESTAMPTZ,
  UNIQUE ("participantId", "applicationId")
);
CREATE INDEX "ExperienceSelection_participantId_status_idx" ON "ExperienceSelection"("participantId", "status");
