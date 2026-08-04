-- CreateTable
CREATE TABLE "ProtocolTvl" (
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tvlUsd" DECIMAL(20,2) NOT NULL,
    "chains" TEXT[],
    "observationId" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProtocolTvl_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "Outcome" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "result" TEXT NOT NULL,
    "payoutUsd" DECIMAL(20,2),
    "notes" TEXT,
    "signalSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProtocolTvl_fetchedAt_idx" ON "ProtocolTvl"("fetchedAt");

-- CreateIndex
CREATE INDEX "Outcome_scopeId_submittedAt_idx" ON "Outcome"("scopeId", "submittedAt");

-- CreateIndex
CREATE INDEX "Outcome_result_submittedAt_idx" ON "Outcome"("result", "submittedAt");

-- AddForeignKey
ALTER TABLE "Outcome" ADD CONSTRAINT "Outcome_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "Scope"("id") ON DELETE CASCADE ON UPDATE CASCADE;
