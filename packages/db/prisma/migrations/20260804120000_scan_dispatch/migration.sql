-- CreateTable
CREATE TABLE "ScanDispatch" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "repoKey" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "krittScanId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "score" DOUBLE PRECISION NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ScanDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScanDispatch_status_createdAt_idx" ON "ScanDispatch"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ScanDispatch_scopeId_idx" ON "ScanDispatch"("scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "ScanDispatch_repoKey_commitSha_key" ON "ScanDispatch"("repoKey", "commitSha");

-- AddForeignKey
ALTER TABLE "ScanDispatch" ADD CONSTRAINT "ScanDispatch_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "Scope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

