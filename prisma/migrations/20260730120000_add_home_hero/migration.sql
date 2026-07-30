CREATE TABLE "HomeHero" (
  "id" TEXT NOT NULL DEFAULT 'home',
  "eyebrow" TEXT NOT NULL,
  "eyebrowId" TEXT,
  "title" TEXT NOT NULL,
  "titleId" TEXT,
  "outlinedTitle" TEXT NOT NULL,
  "outlinedTitleId" TEXT,
  "body" TEXT NOT NULL,
  "bodyId" TEXT,
  "ctaLabel" TEXT NOT NULL,
  "ctaLabelId" TEXT,
  "desktopImageUrl" TEXT NOT NULL,
  "mobileImageUrl" TEXT NOT NULL,
  "collectionId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "HomeHero_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HomeHero_collectionId_idx" ON "HomeHero"("collectionId");

ALTER TABLE "HomeHero"
ADD CONSTRAINT "HomeHero_collectionId_fkey"
FOREIGN KEY ("collectionId") REFERENCES "Collection"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
