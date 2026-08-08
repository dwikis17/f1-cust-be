CREATE TYPE "ShipmentCollectionMethod" AS ENUM ('PICKUP', 'DROP_OFF');

ALTER TABLE "Order"
  ADD COLUMN "shipmentCollectionMethod" "ShipmentCollectionMethod",
  ADD COLUMN "shipmentAvailableCollectionMethods" "ShipmentCollectionMethod"[] NOT NULL DEFAULT ARRAY[]::"ShipmentCollectionMethod"[];

UPDATE "Order"
SET
  "shipmentCollectionMethod" = 'PICKUP',
  "shipmentAvailableCollectionMethods" = ARRAY['PICKUP']::"ShipmentCollectionMethod"[]
WHERE "shipmentBookingStatus" = 'BOOKED';
