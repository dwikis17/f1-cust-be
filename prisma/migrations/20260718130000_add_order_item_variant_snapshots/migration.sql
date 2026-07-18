ALTER TABLE "OrderItem"
ADD COLUMN "color" TEXT,
ADD COLUMN "size" TEXT;

UPDATE "OrderItem" AS item
SET
  "color" = variant."color",
  "size" = variant."size"
FROM "ProductVariant" AS variant
WHERE item."variantId" = variant."id";
