-- CreateTable
CREATE TABLE "Faq" (
    "id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "questionId" TEXT,
    "answer" TEXT NOT NULL,
    "answerId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Faq_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Faq_position_check" CHECK ("position" >= 0)
);

-- CreateIndex
CREATE INDEX "Faq_active_position_createdAt_idx" ON "Faq"("active", "position", "createdAt");
