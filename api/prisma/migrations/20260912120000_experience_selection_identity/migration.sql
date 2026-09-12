-- Experience membership references application identity without owning Application rows.
-- Enables LifeOS eligible catalog IDs without duplicating the Application registry.
ALTER TABLE "ExperienceSelection" DROP CONSTRAINT IF EXISTS "ExperienceSelection_applicationId_fkey";
