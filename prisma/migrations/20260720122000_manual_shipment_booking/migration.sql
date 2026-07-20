ALTER TABLE "Order"
  ADD COLUMN "shipmentBookingStartedAt" TIMESTAMP(3),
  ADD COLUMN "shipmentConfirmationEmailSendingAt" TIMESTAMP(3),
  ADD COLUMN "shipmentConfirmationEmailSentAt" TIMESTAMP(3);

UPDATE "Order"
SET "lifecycleStatus" = 'FULFILLED'
WHERE "shipmentBookingStatus" = 'BOOKED'
  AND "lifecycleStatus" <> 'CANCELLED';

CREATE INDEX "Order_shipmentBookingStartedAt_idx" ON "Order"("shipmentBookingStartedAt");
