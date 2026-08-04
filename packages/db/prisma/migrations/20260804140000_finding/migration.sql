-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "krittVulnId" TEXT NOT NULL,
    "rank" INTEGER,
    "title" TEXT NOT NULL,
    "vulnerabilityType" TEXT,
    "filePath" TEXT,
    "line" INTEGER,
    "severity" TEXT,
    "exploitable" BOOLEAN,
    "explanation" TEXT,
    "maliciousInput" TEXT,
    "maliciousActor" TEXT,
    "triggerFlow" TEXT[],
    "bountyRank" INTEGER,
    "impactLevel" TEXT,
    "minRewardUsd" DECIMAL(20,2),
    "maxRewardUsd" DECIMAL(20,2),
    "rankReasoning" TEXT,
    "clusterId" TEXT,
    "raw" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "decidedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Finding_status_bountyRank_idx" ON "Finding"("status", "bountyRank");

-- CreateIndex
CREATE INDEX "Finding_dispatchId_idx" ON "Finding"("dispatchId");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_dispatchId_krittVulnId_key" ON "Finding"("dispatchId", "krittVulnId");

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "ScanDispatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

