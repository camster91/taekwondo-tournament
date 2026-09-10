-- Add publicScoreboardRefreshMs field to Tournament model
-- Default: 10000ms (10 seconds)
-- Range: 3000-60000ms (3-60 seconds)

ALTER TABLE "Tournament" 
ADD COLUMN IF NOT EXISTS "publicScoreboardRefreshMs" INTEGER DEFAULT 10000;
