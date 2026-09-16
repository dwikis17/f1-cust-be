ALTER TABLE "Order"
ADD COLUMN "pendingPaymentEmailSendingAt" TIMESTAMP(3),
ADD COLUMN "pendingPaymentEmailSentAt" TIMESTAMP(3);
