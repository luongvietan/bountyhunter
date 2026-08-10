-- AlterTable
ALTER TABLE "MergeCandidate" ADD COLUMN "decidedBy" TEXT;
ALTER TABLE "MergeCandidate" ADD COLUMN "decisionNote" TEXT;

-- AlterTable
ALTER TABLE "Finding" ADD COLUMN "decidedBy" TEXT;
ALTER TABLE "Finding" ADD COLUMN "triageReason" TEXT;
