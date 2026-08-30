ALTER TABLE "Order" ADD COLUMN "paymentExpiresAt" TIMESTAMP(3);

UPDATE "Order"
SET "paymentExpiresAt" = "createdAt" + INTERVAL '24 hours';

ALTER TABLE "Order" ALTER COLUMN "paymentExpiresAt" SET NOT NULL;

CREATE INDEX "Order_paymentStatus_paymentExpiresAt_idx"
ON "Order"("paymentStatus", "paymentExpiresAt");
