-- Audit events reference application identity without owning Application rows.
-- Enables EXPERIENCE_* audit for LifeOS catalog IDs (no Application FK target).
ALTER TABLE "AuditEvent" DROP CONSTRAINT IF EXISTS "AuditEvent_applicationId_fkey";
