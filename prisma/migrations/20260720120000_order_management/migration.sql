ALTER TYPE "FulfillmentStatus" RENAME TO "ShipmentBookingStatus";
ALTER TABLE "Order" RENAME COLUMN "fulfillmentStatus" TO "shipmentBookingStatus";
ALTER INDEX "Order_fulfillmentStatus_createdAt_idx" RENAME TO "Order_shipmentBookingStatus_createdAt_idx";

CREATE TYPE "OrderLifecycleStatus" AS ENUM ('UNFULFILLED', 'PROCESSING', 'FULFILLED', 'CANCELLED');
CREATE TYPE "OrderAuditOutcome" AS ENUM ('SUCCEEDED', 'FAILED');

ALTER TABLE "Order"
  ADD COLUMN "lifecycleStatus" "OrderLifecycleStatus" NOT NULL DEFAULT 'UNFULFILLED',
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "externalRefundedAt" TIMESTAMP(3);

CREATE TABLE "OrderAuditEvent" (
  "id" UUID NOT NULL,
  "orderId" UUID,
  "adminId" UUID,
  "action" TEXT NOT NULL,
  "outcome" "OrderAuditOutcome" NOT NULL,
  "reason" TEXT,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderAuditEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "OrderAuditEvent"
  ADD CONSTRAINT "OrderAuditEvent_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderAuditEvent"
  ADD CONSTRAINT "OrderAuditEvent_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Order_lifecycleStatus_createdAt_idx" ON "Order"("lifecycleStatus", "createdAt");
CREATE INDEX "Order_email_idx" ON "Order"("email");
CREATE INDEX "Order_phone_idx" ON "Order"("phone");
CREATE INDEX "Order_biteshipTrackingId_idx" ON "Order"("biteshipTrackingId");
CREATE INDEX "Order_biteshipWaybillId_idx" ON "Order"("biteshipWaybillId");
CREATE INDEX "OrderAuditEvent_orderId_createdAt_idx" ON "OrderAuditEvent"("orderId", "createdAt");
CREATE INDEX "OrderAuditEvent_adminId_createdAt_idx" ON "OrderAuditEvent"("adminId", "createdAt");
CREATE INDEX "OrderAuditEvent_action_createdAt_idx" ON "OrderAuditEvent"("action", "createdAt");
