-- AlterTable
ALTER TABLE "Product"
    ADD COLUMN "salePriceIdr" INTEGER;

ALTER TABLE "Product" ADD CONSTRAINT "Product_sale_price_check" CHECK (
    "salePriceIdr" IS NULL
    OR ("salePriceIdr" > 0 AND "salePriceIdr" < "priceIdr")
);
