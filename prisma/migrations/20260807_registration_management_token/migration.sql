-- Parent self-service uses a high-entropy bearer token. Only its SHA-256
-- digest is stored so a database read cannot reveal usable management URLs.
ALTER TABLE "Registration"
ADD COLUMN "managementTokenHash" TEXT;

CREATE UNIQUE INDEX "Registration_managementTokenHash_key"
ON "Registration"("managementTokenHash");
