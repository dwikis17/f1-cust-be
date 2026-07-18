-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('UNFULFILLED', 'BOOKED', 'BOOKING_FAILED');

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "subtotalIdr" INTEGER NOT NULL,
    "shippingIdr" INTEGER NOT NULL,
    "totalIdr" INTEGER NOT NULL,
    "courierCode" TEXT NOT NULL,
    "courierName" TEXT NOT NULL,
    "courierServiceCode" TEXT NOT NULL,
    "courierServiceName" TEXT NOT NULL,
    "courierDuration" TEXT NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "midtransStatus" TEXT NOT NULL DEFAULT 'pending',
    "midtransTransactionId" TEXT,
    "midtransPaymentType" TEXT,
    "midtransSnapToken" TEXT,
    "stockReleasedAt" TIMESTAMP(3),
    "fulfillmentStatus" "FulfillmentStatus" NOT NULL DEFAULT 'UNFULFILLED',
    "biteshipOrderId" TEXT,
    "biteshipTrackingId" TEXT,
    "biteshipWaybillId" TEXT,
    "biteshipPriceIdr" INTEGER,
    "biteshipStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Order_amounts_check" CHECK ("subtotalIdr" >= 0 AND "shippingIdr" >= 0 AND "totalIdr" = "subtotalIdr" + "shippingIdr")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "variantId" UUID,
    "productName" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "unitPriceIdr" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "packageLengthMm" INTEGER NOT NULL,
    "packageWidthMm" INTEGER NOT NULL,
    "packageHeightMm" INTEGER NOT NULL,
    "packageWeightG" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrderItem_values_check" CHECK ("unitPriceIdr" >= 0 AND "quantity" > 0 AND "packageLengthMm" > 0 AND "packageWidthMm" > 0 AND "packageHeightMm" > 0 AND "packageWeightG" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");
CREATE UNIQUE INDEX "Order_biteshipOrderId_key" ON "Order"("biteshipOrderId");
CREATE INDEX "Order_paymentStatus_createdAt_idx" ON "Order"("paymentStatus", "createdAt");
CREATE INDEX "Order_fulfillmentStatus_createdAt_idx" ON "Order"("fulfillmentStatus", "createdAt");
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX "OrderItem_variantId_idx" ON "OrderItem"("variantId");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
