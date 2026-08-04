import type { PrismaClient } from '@kritt-radar/db';
import { buildReport, type ReportFinding, type ReportTarget } from '@kritt-radar/pipeline';

export type FindingStatus = 'new' | 'reviewed' | 'submitted' | 'dismissed';

const STATUSES: readonly FindingStatus[] = ['new', 'reviewed', 'submitted', 'dismissed'];

export function parseFindingStatus(value: string | string[] | undefined): FindingStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
    ? (value as FindingStatus)
    : 'new';
}

export interface QueuedFinding {
  id: string;
  status: FindingStatus;
  title: string;
  severity: string | null;
  impactLevel: string | null;
  vulnerabilityType: string | null;
  filePath: string | null;
  line: number | null;
  exploitable: boolean | null;
  minRewardUsd: number | null;
  maxRewardUsd: number | null;
  rankReasoning: string | null;
  repoKey: string;
  commitSha: string;
  programTitle: string;
  programUrl: string;
  platform: string;
  report: string;
  /** Reasons this draft is not ready to send, shown before the submit control. */
  blockers: string[];
  fetchedAt: string;
  decidedAt: string | null;
}

export interface FindingQueuePage {
  status: FindingStatus;
  counts: Record<FindingStatus, number>;
  findings: QueuedFinding[];
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * What must be true before a report is worth a platform's attention. Shown
 * rather than enforced: the operator may know something the scan does not, but
 * they should have to see the gap first.
 */
export function reportBlockers(finding: {
  maliciousInput: string | null;
  exploitable: boolean | null;
  explanation: string | null;
  filePath: string | null;
}): string[] {
  const blockers: string[] = [];
  if (!finding.maliciousInput?.trim()) blockers.push('No proof of concept');
  if (finding.exploitable !== true) blockers.push('Exploitability not confirmed');
  if (!finding.explanation?.trim()) blockers.push('No written explanation');
  if (!finding.filePath?.trim()) blockers.push('No file location');
  return blockers;
}

export async function listFindingQueue(
  prisma: PrismaClient,
  status: FindingStatus,
): Promise<FindingQueuePage> {
  const [rows, grouped] = await Promise.all([
    prisma.finding.findMany({
      where: { status },
      include: { dispatch: { include: { scope: { include: { program: true } } } } },
      // Kritt's bounty rank is the closest thing to expected value, so it
      // leads; unranked findings fall to the end rather than sorting as zero.
      orderBy: [{ bountyRank: 'asc' }, { rank: 'asc' }, { fetchedAt: 'desc' }],
    }),
    prisma.finding.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const counts: Record<FindingStatus, number> = {
    new: 0,
    reviewed: 0,
    submitted: 0,
    dismissed: 0,
  };
  for (const group of grouped) {
    if ((STATUSES as readonly string[]).includes(group.status)) {
      counts[group.status as FindingStatus] = group._count._all;
    }
  }

  const findings = rows.map((row): QueuedFinding => {
    const program = row.dispatch.scope.program;
    const reportFinding: ReportFinding = {
      title: row.title,
      vulnerabilityType: row.vulnerabilityType,
      severity: row.severity,
      impactLevel: row.impactLevel,
      filePath: row.filePath,
      line: row.line,
      explanation: row.explanation,
      maliciousInput: row.maliciousInput,
      maliciousActor: row.maliciousActor,
      triggerFlow: row.triggerFlow,
      exploitable: row.exploitable,
      minRewardUsd: toNumber(row.minRewardUsd),
      maxRewardUsd: toNumber(row.maxRewardUsd),
    };
    const reportTarget: ReportTarget = {
      repoKey: row.dispatch.repoKey,
      commitSha: row.dispatch.commitSha,
      programTitle: program.title,
      platform: program.platform,
    };

    return {
      id: row.id,
      status: row.status as FindingStatus,
      title: row.title,
      severity: row.severity,
      impactLevel: row.impactLevel,
      vulnerabilityType: row.vulnerabilityType,
      filePath: row.filePath,
      line: row.line,
      exploitable: row.exploitable,
      minRewardUsd: toNumber(row.minRewardUsd),
      maxRewardUsd: toNumber(row.maxRewardUsd),
      rankReasoning: row.rankReasoning,
      repoKey: row.dispatch.repoKey,
      commitSha: row.dispatch.commitSha,
      programTitle: program.title,
      programUrl: program.url,
      platform: program.platform,
      report: buildReport(reportFinding, reportTarget),
      blockers: reportBlockers(row),
      fetchedAt: row.fetchedAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
    };
  });

  return { status, counts, findings };
}
