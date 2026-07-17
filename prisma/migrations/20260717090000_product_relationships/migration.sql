-- CreateEnum
CREATE TYPE "ProductAudience" AS ENUM ('MEN', 'WOMEN', 'KIDS', 'UNISEX');

-- CreateEnum
CREATE TYPE "CollectionKind" AS ENUM ('DOMAIN', 'TEAM', 'DRIVER', 'MERCHANDISE', 'BRAND', 'PROMOTION', 'MANUAL');

-- Driver current-team membership is profile data and may be unknown.
ALTER TABLE "Driver" ALTER COLUMN "teamId" DROP NOT NULL;

-- Add product audience.
ALTER TABLE "Product" ADD COLUMN "audience" "ProductAudience";

-- Allow a default SKU or a size-only SKU without fake option values.
DROP INDEX IF EXISTS "ProductVariant_productId_size_color_key";
ALTER TABLE "ProductVariant"
  ALTER COLUMN "size" DROP NOT NULL,
  ALTER COLUMN "color" DROP NOT NULL,
  ALTER COLUMN "sizingGuide" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Collection" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "kind" "CollectionKind" NOT NULL,
  "parentId" UUID,
  "imageUrl" TEXT,
  "description" TEXT NOT NULL DEFAULT '',
  "position" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductDriver" (
  "productId" UUID NOT NULL,
  "driverId" UUID NOT NULL,
  CONSTRAINT "ProductDriver_pkey" PRIMARY KEY ("productId", "driverId")
);

-- CreateTable
CREATE TABLE "ProductCollection" (
  "productId" UUID NOT NULL,
  "collectionId" UUID NOT NULL,
  "position" INTEGER,
  "featured" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "ProductCollection_pkey" PRIMARY KEY ("productId", "collectionId")
);

-- Backfill existing singular driver assignments before removing the old column.
INSERT INTO "ProductDriver" ("productId", "driverId")
SELECT "id", "driverId" FROM "Product" WHERE "driverId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Remove the obsolete singular driver relation.
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_driverId_fkey";
DROP INDEX IF EXISTS "Product_driverId_idx";
ALTER TABLE "Product" DROP COLUMN "driverId";

-- CreateIndex
CREATE UNIQUE INDEX "Collection_slug_key" ON "Collection"("slug");
CREATE INDEX "Collection_parentId_position_idx" ON "Collection"("parentId", "position");
CREATE INDEX "Collection_kind_active_idx" ON "Collection"("kind", "active");
CREATE INDEX "Product_audience_idx" ON "Product"("audience");
CREATE INDEX "ProductDriver_driverId_idx" ON "ProductDriver"("driverId");
CREATE INDEX "ProductCollection_collectionId_position_idx" ON "ProductCollection"("collectionId", "position");

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Collection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductDriver" ADD CONSTRAINT "ProductDriver_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductDriver" ADD CONSTRAINT "ProductDriver_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductCollection" ADD CONSTRAINT "ProductCollection_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductCollection" ADD CONSTRAINT "ProductCollection_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
