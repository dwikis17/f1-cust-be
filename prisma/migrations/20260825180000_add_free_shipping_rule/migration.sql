CREATE TABLE "FreeShippingRule" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "minimumPurchaseIdr" INTEGER NOT NULL DEFAULT 1000000,
    "maxCoverageIdr" INTEGER NOT NULL DEFAULT 25000,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FreeShippingRule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FreeShippingRule_singleton" CHECK ("id" = 1),
    CONSTRAINT "FreeShippingRule_minimum_positive" CHECK ("minimumPurchaseIdr" > 0),
    CONSTRAINT "FreeShippingRule_coverage_positive" CHECK ("maxCoverageIdr" > 0)
);

INSERT INTO "FreeShippingRule" ("id") VALUES (1);

ALTER TABLE "Order" ADD COLUMN "shippingOriginalIdr" INTEGER;
ALTER TABLE "Order" ADD COLUMN "shippingDiscountIdr" INTEGER NOT NULL DEFAULT 0;
UPDATE "Order" SET "shippingOriginalIdr" = "shippingIdr";
ALTER TABLE "Order" ALTER COLUMN "shippingOriginalIdr" SET NOT NULL;
