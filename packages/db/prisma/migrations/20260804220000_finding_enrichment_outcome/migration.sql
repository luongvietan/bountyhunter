-- Post-script chain output, stored per finding.
ALTER TABLE "Finding" ADD COLUMN "krittReport" TEXT;
ALTER TABLE "Finding" ADD COLUMN "pocDiff" TEXT;
ALTER TABLE "Finding" ADD COLUMN "inScope" BOOLEAN;
ALTER TABLE "Finding" ADD COLUMN "postScriptValid" BOOLEAN;

-- An outcome may settle a queued finding. Existing rows keep a null link:
-- they were recorded against a scope before the queue existed.
ALTER TABLE "Outcome" ADD COLUMN "findingId" TEXT;

CREATE UNIQUE INDEX "Outcome_findingId_key" ON "Outcome"("findingId");

ALTER TABLE "Outcome" ADD CONSTRAINT "Outcome_findingId_fkey"
    FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
