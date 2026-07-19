ALTER TABLE "Order" ADD COLUMN "orderNumber" TEXT;

UPDATE "Order"
SET "orderNumber" = 'VLD-'
  || UPPER(SUBSTRING(REPLACE("id"::text, '-', '') FROM 1 FOR 4)) || '-'
  || UPPER(SUBSTRING(REPLACE("id"::text, '-', '') FROM 5 FOR 4)) || '-'
  || UPPER(SUBSTRING(REPLACE("id"::text, '-', '') FROM 9 FOR 4));

ALTER TABLE "Order" ALTER COLUMN "orderNumber" SET NOT NULL;

CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");
