-- AlterTable
ALTER TABLE "Collection" ADD COLUMN     "driverId" UUID,
ADD COLUMN     "teamId" UUID;

-- CreateIndex
CREATE INDEX "Collection_teamId_idx" ON "Collection"("teamId");

-- CreateIndex
CREATE INDEX "Collection_driverId_idx" ON "Collection"("driverId");

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
