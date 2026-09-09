-- P2-2: Payment at registration
-- Add payment tracking fields to Registration model
-- Tournament.settings JSON already exists; fee config (tournamentFeeCents, feeNotes, requiresPayment) will be stored there

ALTER TABLE "Registration" ADD COLUMN "paymentStatus" TEXT DEFAULT 'not_required';
ALTER TABLE "Registration" ADD COLUMN "paymentIntentId" TEXT;
ALTER TABLE "Registration" ADD COLUMN "paymentAmountCents" INTEGER;
ALTER TABLE "Registration" ADD COLUMN "paymentReceivedAt" TIMESTAMP(3);

-- Index for quick filtering by payment status (staff views)
CREATE INDEX "Registration_tournamentId_paymentStatus_idx" ON "Registration"("tournamentId", "paymentStatus");

COMMENT ON COLUMN "Registration"."paymentStatus" IS 'not_required (no fee or waived), pending (awaiting payment), paid (confirmed via webhook), waived (manual override), failed (checkout abandoned/failed)';
COMMENT ON COLUMN "Registration"."paymentIntentId" IS 'Stripe PaymentIntent or Checkout Session ID for reconciliation';
COMMENT ON COLUMN "Registration"."paymentAmountCents" IS 'Amount paid in cents (audit copy; Stripe is source of truth)';
COMMENT ON COLUMN "Registration"."paymentReceivedAt" IS 'Timestamp when payment webhook confirmed successful payment';
