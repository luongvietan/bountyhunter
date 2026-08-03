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

-- Consolidate legacy duplicate URLs before enforcing report identity. The newest
-- report wins; equal publication timestamps use the lexicographically smallest ID.
-- Observation IDs remain replayable by merging distinct non-null values onto the
-- retained report before duplicate rows are removed.
WITH grouped_reports AS (
    SELECT
        report."reportUrl",
        (array_agg(report."id" ORDER BY report."publishedAt" DESC, report."id" ASC))[1] AS "canonicalId",
        COALESCE(
            array_agg(DISTINCT observation."id" ORDER BY observation."id") FILTER (WHERE observation."id" IS NOT NULL),
            ARRAY[]::TEXT[]
        ) AS "observationIds"
    FROM "AuditReport" AS report
    LEFT JOIN LATERAL unnest(report."observationIds") AS observation("id") ON TRUE
    GROUP BY report."reportUrl"
),
updated_reports AS (
    UPDATE "AuditReport" AS report
    SET "observationIds" = grouped_reports."observationIds"
    FROM grouped_reports
    WHERE report."id" = grouped_reports."canonicalId"
      AND report."observationIds" IS DISTINCT FROM grouped_reports."observationIds"
    RETURNING report."id"
)
DELETE FROM "AuditReport" AS duplicate
USING grouped_reports
WHERE duplicate."reportUrl" = grouped_reports."reportUrl"
  AND duplicate."id" <> grouped_reports."canonicalId";

-- CreateIndex
CREATE UNIQUE INDEX "AuditReport_reportUrl_key" ON "AuditReport"("reportUrl");

-- AddForeignKey
ALTER TABLE "EntityAlias" ADD CONSTRAINT "EntityAlias_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MergeCandidate" ADD CONSTRAINT "MergeCandidate_leftEntityId_fkey" FOREIGN KEY ("leftEntityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MergeCandidate" ADD CONSTRAINT "MergeCandidate_rightEntityId_fkey" FOREIGN KEY ("rightEntityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
