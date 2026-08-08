ALTER TABLE "Order"
  ADD COLUMN "telegramNotificationQueuedAt" TIMESTAMP(3),
  ADD COLUMN "telegramNotificationSendingAt" TIMESTAMP(3),
  ADD COLUMN "telegramNotificationSentAt" TIMESTAMP(3),
  ADD COLUMN "telegramNotificationFailedAt" TIMESTAMP(3),
  ADD COLUMN "telegramNotificationAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "telegramNotificationLastError" TEXT;

CREATE INDEX "Order_telegramNotificationQueuedAt_telegramNotificationSentAt_idx"
  ON "Order"("telegramNotificationQueuedAt", "telegramNotificationSentAt");
