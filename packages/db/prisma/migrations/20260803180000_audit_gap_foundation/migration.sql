-- CreateTable
CREATE TABLE "EntityAlias" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MergeCandidate" (
    "id" TEXT NOT NULL,
    "leftEntityId" TEXT NOT NULL,
    "rightEntityId" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" JSONB NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MergeCandidate_pkey" PRIMARY KEY ("id")
);

-- Add required audit identity fields without rejecting existing reports.
ALTER TABLE "AuditReport" ADD COLUMN "projectHint" TEXT;
UPDATE "AuditReport" SET "projectHint" = '' WHERE "projectHint" IS NULL;
ALTER TABLE "AuditReport" ALTER COLUMN "projectHint" SET NOT NULL;

ALTER TABLE "AuditReport" ADD COLUMN "observationIds" TEXT[];
UPDATE "AuditReport" SET "observationIds" = ARRAY[]::TEXT[] WHERE "observationIds" IS NULL;
ALTER TABLE "AuditReport" ALTER COLUMN "observationIds" SET NOT NULL;

-- CreateIndex
CREATE INDEX "EntityAlias_entityId_idx" ON "EntityAlias"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityAlias_kind_key_key" ON "EntityAlias"("kind", "key");

-- CreateIndex
CREATE INDEX "MergeCandidate_status_similarity_idx" ON "MergeCandidate"("status", "similarity");

-- CreateIndex
CREATE UNIQUE INDEX "MergeCandidate_leftEntityId_rightEntityId_key" ON "MergeCandidate"("leftEntityId", "rightEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditReport_reportUrl_key" ON "AuditReport"("reportUrl");

-- AddForeignKey
ALTER TABLE "EntityAlias" ADD CONSTRAINT "EntityAlias_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MergeCandidate" ADD CONSTRAINT "MergeCandidate_leftEntityId_fkey" FOREIGN KEY ("leftEntityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MergeCandidate" ADD CONSTRAINT "MergeCandidate_rightEntityId_fkey" FOREIGN KEY ("rightEntityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
