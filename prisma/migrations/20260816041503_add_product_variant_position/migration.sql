-- AlterTable
ALTER TABLE "HomeHero" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- RenameIndex
ALTER INDEX "Order_telegramNotificationQueuedAt_telegramNotificationSentAt_i" RENAME TO "Order_telegramNotificationQueuedAt_telegramNotificationSent_idx";
