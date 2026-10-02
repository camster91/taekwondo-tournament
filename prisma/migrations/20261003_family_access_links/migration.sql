-- Family portal: short-lived emailed links (token hash only). Additive.
CREATE TABLE "FamilyAccessLink" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FamilyAccessLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FamilyAccessLink_tokenHash_key" ON "FamilyAccessLink"("tokenHash");
CREATE INDEX "FamilyAccessLink_email_idx" ON "FamilyAccessLink"("email");
CREATE INDEX "FamilyAccessLink_expiresAt_idx" ON "FamilyAccessLink"("expiresAt");
