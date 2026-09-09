-- Add tenant branding fields to Tournament and Organization models
-- AlterTable Tournament
ALTER TABLE "Tournament" ADD COLUMN "brandName" TEXT,
ADD COLUMN "brandPrimaryColor" TEXT DEFAULT '#DC2626',
ADD COLUMN "brandLogoUrl" TEXT;

-- AlterTable Organization
ALTER TABLE "Organization" ADD COLUMN "brandName" TEXT,
ADD COLUMN "brandPrimaryColor" TEXT DEFAULT '#DC2626',
ADD COLUMN "brandLogoUrl" TEXT;
