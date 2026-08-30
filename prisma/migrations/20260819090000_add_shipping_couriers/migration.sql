-- CreateTable
CREATE TABLE "ShippingCourier" (
    "code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingCourier_pkey" PRIMARY KEY ("code")
);

-- Preserve the courier allowlist that was previously configured in BITESHIP_COURIERS.
INSERT INTO "ShippingCourier" ("code", "active", "createdAt", "updatedAt")
VALUES
    ('jne', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('jnt', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('sicepat', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('anteraja', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
