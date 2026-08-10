-- AlterTable
ALTER TABLE "ScanDispatch" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ScanDispatch" ADD COLUMN "providerUsed" TEXT;
ALTER TABLE "ScanDispatch" ADD COLUMN "scopeFileCount" INTEGER;

-- CreateTable
CREATE TABLE "OpsEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpsEvent_kind_createdAt_idx" ON "OpsEvent"("kind", "createdAt");
