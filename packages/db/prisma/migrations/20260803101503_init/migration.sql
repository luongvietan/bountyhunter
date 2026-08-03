-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "entityId" TEXT,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "poolUsd" DECIMAL(20,2),
    "kind" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scope" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "hardKey" TEXT,
    "repoUrl" TEXT,
    "commitish" TEXT,
    "pathGlobs" TEXT[],
    "chain" TEXT,
    "address" TEXT,

    CONSTRAINT "Scope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditReport" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "firm" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "reportUrl" TEXT NOT NULL,
    "coveredCommit" TEXT,
    "coveredPaths" TEXT[],

    CONSTRAINT "AuditReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL,
    "collectorId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL,
    "observationIds" TEXT[],
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Score" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "breakdown" JSONB NOT NULL,
    "weightsVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Score_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectorRun" (
    "id" TEXT NOT NULL,
    "collectorId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "CollectorRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Entity_slug_key" ON "Entity"("slug");

-- CreateIndex
CREATE INDEX "Program_entityId_idx" ON "Program"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Program_platform_externalId_key" ON "Program"("platform", "externalId");

-- CreateIndex
CREATE INDEX "Scope_programId_idx" ON "Scope"("programId");

-- CreateIndex
CREATE INDEX "Scope_hardKey_idx" ON "Scope"("hardKey");

-- CreateIndex
CREATE INDEX "AuditReport_entityId_publishedAt_idx" ON "AuditReport"("entityId", "publishedAt");

-- CreateIndex
CREATE INDEX "Observation_collectorId_fetchedAt_idx" ON "Observation"("collectorId", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Observation_collectorId_sourceUrl_contentHash_key" ON "Observation"("collectorId", "sourceUrl", "contentHash");

-- CreateIndex
CREATE INDEX "Signal_scopeId_idx" ON "Signal"("scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "Signal_scopeId_type_key" ON "Signal"("scopeId", "type");

-- CreateIndex
CREATE INDEX "Score_total_idx" ON "Score"("total");

-- CreateIndex
CREATE UNIQUE INDEX "Score_scopeId_weightsVersion_key" ON "Score"("scopeId", "weightsVersion");

-- CreateIndex
CREATE INDEX "CollectorRun_collectorId_startedAt_idx" ON "CollectorRun"("collectorId", "startedAt");

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scope" ADD CONSTRAINT "Scope_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditReport" ADD CONSTRAINT "AuditReport_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "Scope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "Scope"("id") ON DELETE CASCADE ON UPDATE CASCADE;
