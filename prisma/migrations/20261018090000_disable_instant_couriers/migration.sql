-- Instant couriers need exact delivery coordinates, which checkout no longer collects.
UPDATE "ShippingCourier"
SET "active" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('gojek', 'grab', 'lalamove', 'borzo', 'deliveree', 'rara');
