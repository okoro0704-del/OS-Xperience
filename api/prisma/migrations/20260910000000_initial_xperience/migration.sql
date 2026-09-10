-- Initial OS Xperience durable records. Apply with `npx prisma migrate deploy`.
CREATE TYPE "ReviewState" AS ENUM ('DRAFT','SUBMITTED','UNDER_REVIEW','CHANGES_REQUIRED','APPROVED','PUBLISHED','SUSPENDED','REVOKED');
CREATE TYPE "EvidenceType" AS ENUM ('DOMAIN','WELL_KNOWN_ENDPOINT','GITHUB','DEPLOYMENT_PROVIDER','XPERIENCE_ENDPOINT');
CREATE TYPE "EvidenceStatus" AS ENUM ('PENDING','VERIFIED','FAILED','UNAVAILABLE');
CREATE TYPE "CapabilityReviewState" AS ENUM ('REQUESTED','APPROVED','REJECTED','REQUIRES_CHANGES');
CREATE TABLE "Developer" ("id" TEXT PRIMARY KEY, "email" TEXT NOT NULL UNIQUE, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "DeveloperIdentity" ("id" TEXT PRIMARY KEY,"developerId" TEXT NOT NULL REFERENCES "Developer"("id"),"provider" TEXT NOT NULL,"subject" TEXT NOT NULL, UNIQUE("provider","subject"));
CREATE TABLE "Application" ("id" TEXT PRIMARY KEY,"manifest" JSONB NOT NULL,"state" "ReviewState" NOT NULL DEFAULT 'DRAFT',"revision" INTEGER NOT NULL DEFAULT 1,"developerId" TEXT NOT NULL REFERENCES "Developer"("id"));
CREATE INDEX "Application_developerId_state_idx" ON "Application"("developerId","state");
CREATE TABLE "ApplicationManifest" ("id" TEXT PRIMARY KEY,"applicationId" TEXT NOT NULL REFERENCES "Application"("id"),"revision" INTEGER NOT NULL,"claim" JSONB NOT NULL,UNIQUE("applicationId","revision"));
CREATE TABLE "ManifestRevision" ("id" TEXT PRIMARY KEY,"applicationId" TEXT NOT NULL REFERENCES "Application"("id"),"revision" INTEGER NOT NULL,"claim" JSONB NOT NULL,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE("applicationId","revision"));
CREATE TABLE "ApplicationCapability" ("id" TEXT PRIMARY KEY,"applicationId" TEXT NOT NULL REFERENCES "Application"("id"),"capability" TEXT NOT NULL,"status" "CapabilityReviewState" NOT NULL DEFAULT 'REQUESTED',UNIQUE("applicationId","capability"));
CREATE TABLE "VerificationEvidence" ("id" TEXT PRIMARY KEY,"applicationId" TEXT NOT NULL REFERENCES "Application"("id"),"type" "EvidenceType" NOT NULL,"locator" TEXT NOT NULL,"status" "EvidenceStatus" NOT NULL DEFAULT 'PENDING');
CREATE TABLE "VerificationAttempt" ("id" TEXT PRIMARY KEY,"evidenceId" TEXT NOT NULL REFERENCES "VerificationEvidence"("id"),"outcome" TEXT NOT NULL,"detail" TEXT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "Review" ("id" TEXT PRIMARY KEY,"applicationId" TEXT NOT NULL REFERENCES "Application"("id"),"reviewerId" TEXT NOT NULL,"state" "ReviewState" NOT NULL,"note" TEXT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "ReviewAction" ("id" TEXT PRIMARY KEY,"reviewId" TEXT NOT NULL REFERENCES "Review"("id"),"action" TEXT NOT NULL,"actorId" TEXT NOT NULL,"detail" TEXT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "Publication" ("id" TEXT PRIMARY KEY,"applicationId" TEXT NOT NULL REFERENCES "Application"("id"),"status" TEXT NOT NULL,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "AuditEvent" ("id" TEXT PRIMARY KEY,"applicationId" TEXT REFERENCES "Application"("id"),"actorId" TEXT NOT NULL,"actorType" TEXT NOT NULL,"action" TEXT NOT NULL,"previousState" TEXT,"newState" TEXT,"reason" TEXT,"detail" JSONB,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "AuditEvent_applicationId_createdAt_idx" ON "AuditEvent"("applicationId","createdAt");
