-- CreateTable
CREATE TABLE "StorefrontContent" (
    "id" TEXT NOT NULL,
    "supportEmail" TEXT NOT NULL,
    "supportWhatsappNumber" TEXT NOT NULL,
    "supportWhatsappDisplay" TEXT NOT NULL,
    "shippingReturns" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorefrontContent_pkey" PRIMARY KEY ("id")
);
