ALTER TABLE "HomeHero"
ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT false;

UPDATE "HomeHero"
SET "id" = gen_random_uuid()::text,
    "active" = true
WHERE "id" = 'home';

ALTER TABLE "HomeHero"
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

CREATE INDEX "HomeHero_active_position_idx" ON "HomeHero"("active", "position");
