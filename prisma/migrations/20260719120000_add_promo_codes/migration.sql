-- CreateTable
CREATE TABLE "PromoCode" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "discountPercentage" INTEGER NOT NULL,
    "maxDiscountIdr" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PromoCode_discount_check" CHECK (
        "discountPercentage" BETWEEN 1 AND 100
        AND ("maxDiscountIdr" IS NULL OR "maxDiscountIdr" > 0)
    )
);

-- AlterTable
ALTER TABLE "Order"
    ADD COLUMN "discountIdr" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "promoCodeId" UUID,
    ADD COLUMN "promoRedeemedAt" TIMESTAMP(3);

ALTER TABLE "Order" DROP CONSTRAINT "Order_amounts_check";
ALTER TABLE "Order" ADD CONSTRAINT "Order_amounts_check" CHECK (
    "subtotalIdr" >= 0
    AND "discountIdr" >= 0
    AND "discountIdr" <= "subtotalIdr"
    AND "shippingIdr" >= 0
    AND "totalIdr" = "subtotalIdr" - "discountIdr" + "shippingIdr"
);

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");
CREATE INDEX "PromoCode_active_createdAt_idx" ON "PromoCode"("active", "createdAt");
CREATE INDEX "Order_promoCodeId_createdAt_idx" ON "Order"("promoCodeId", "createdAt");
CREATE INDEX "Order_promoRedeemedAt_idx" ON "Order"("promoRedeemedAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_promoCodeId_fkey"
    FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
