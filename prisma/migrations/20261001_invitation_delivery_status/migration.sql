-- Invitation lifecycle (#46): record the last delivery attempt and
-- keep cancelled invitations instead of deleting them.
ALTER TABLE "Invitation" ADD COLUMN "deliveryStatus" TEXT;
ALTER TABLE "Invitation" ADD COLUMN "lastDeliveryError" TEXT;
ALTER TABLE "Invitation" ADD COLUMN "lastSentAt" TIMESTAMP(3);
ALTER TABLE "Invitation" ADD COLUMN "cancelledAt" TIMESTAMP(3);
