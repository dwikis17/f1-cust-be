CREATE TYPE "ProductCondition" AS ENUM ('BNIB', 'BNWT', 'BNWOT', 'PRE_OWNED');

ALTER TABLE "Product" ADD COLUMN "condition" "ProductCondition";
UPDATE "Product" SET "condition" = 'BNIB';
ALTER TABLE "Product" ALTER COLUMN "condition" SET NOT NULL;

CREATE INDEX "Product_condition_idx" ON "Product"("condition");
