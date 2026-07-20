ALTER TABLE "Order" ADD COLUMN "externalRefundedByAdminId" UUID;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_externalRefundedByAdminId_fkey"
  FOREIGN KEY ("externalRefundedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Order_externalRefundedByAdminId_idx" ON "Order"("externalRefundedByAdminId");
