-- Add the entered discount so the public badge can show the exact value.
ALTER TABLE "Product"
    ADD COLUMN "salePercentage" INTEGER;

-- Existing sale prices become the nearest valid whole-number percentage, then
-- the stored sale price is normalized to the same calculation used by the API.
WITH sale_backfill AS (
    SELECT
        "id",
        GREATEST(
            1,
            LEAST(
                99,
                ROUND((1 - ("salePriceIdr"::numeric / NULLIF("priceIdr", 0))) * 100)::integer
            )
        ) AS "salePercentage"
    FROM "Product"
    WHERE "salePriceIdr" IS NOT NULL
)
UPDATE "Product" AS product
SET
    "salePercentage" = sale_backfill."salePercentage",
    "salePriceIdr" = ROUND(
        product."priceIdr" * (100 - sale_backfill."salePercentage") / 100.0
    )::integer
FROM sale_backfill
WHERE product."id" = sale_backfill."id";

ALTER TABLE "Product" ADD CONSTRAINT "Product_sale_percentage_check" CHECK (
    "salePercentage" IS NULL OR "salePercentage" BETWEEN 1 AND 99
);

ALTER TABLE "Product" ADD CONSTRAINT "Product_sale_percentage_pair_check" CHECK (
    ("salePercentage" IS NULL AND "salePriceIdr" IS NULL)
    OR ("salePercentage" IS NOT NULL AND "salePriceIdr" IS NOT NULL)
);

ALTER TABLE "Product" ADD CONSTRAINT "Product_sale_price_percentage_check" CHECK (
    "salePercentage" IS NULL
    OR "salePriceIdr" = ROUND("priceIdr" * (100 - "salePercentage") / 100.0)::integer
);
