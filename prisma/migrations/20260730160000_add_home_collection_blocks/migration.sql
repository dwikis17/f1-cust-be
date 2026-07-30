CREATE TABLE "HomeCollectionBlock" (
  "id" UUID NOT NULL,
  "leadImageUrl" TEXT NOT NULL,
  "sideImageOneUrl" TEXT NOT NULL,
  "sideImageTwoUrl" TEXT NOT NULL,
  "collectionId" UUID,
  "position" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "HomeCollectionBlock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HomeCollectionBlock_collectionId_key"
ON "HomeCollectionBlock"("collectionId");

CREATE INDEX "HomeCollectionBlock_active_position_idx"
ON "HomeCollectionBlock"("active", "position");

ALTER TABLE "HomeCollectionBlock"
ADD CONSTRAINT "HomeCollectionBlock_collectionId_fkey"
FOREIGN KEY ("collectionId") REFERENCES "Collection"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
