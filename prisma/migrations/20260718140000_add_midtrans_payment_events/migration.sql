-- CreateEnum
CREATE TYPE "PaymentEventProcessingResult" AS ENUM ('RECEIVED', 'PROCESSED', 'REJECTED');

-- CreateTable
CREATE TABLE "MidtransPaymentEvent" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "statusCode" TEXT NOT NULL,
    "grossAmount" TEXT NOT NULL,
    "transactionStatus" TEXT NOT NULL,
    "transactionId" TEXT,
    "fraudStatus" TEXT,
    "paymentType" TEXT,
    "payload" JSONB NOT NULL,
    "processingResult" "PaymentEventProcessingResult" NOT NULL DEFAULT 'RECEIVED',
    "processingError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "MidtransPaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MidtransPaymentEvent_orderId_receivedAt_idx" ON "MidtransPaymentEvent"("orderId", "receivedAt");

-- AddForeignKey
ALTER TABLE "MidtransPaymentEvent" ADD CONSTRAINT "MidtransPaymentEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
