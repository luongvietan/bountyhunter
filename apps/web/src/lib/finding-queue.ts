import type { PrismaClient } from '@kritt-radar/db';
import { buildReport, findingPermalink, type ReportFinding, type ReportTarget } from '@kritt-radar/pipeline';

export type FindingStatus = 'new' | 'reviewed' | 'submitted' | 'dismissed';

export type IngestBadge = 'unseen' | 'updated' | 'seen';

export type DecidedByFilter = 'operator' | 'auto' | 'ai';

export type BlockerFilter =
  | 'any'
  | 'none'
  | 'No proof of concept'
  | 'Exploitability not confirmed'
  | 'No written explanation'
  | 'No file location'
  | 'Attacker is out of scope for this program'
  | 'Post-script could not confirm the finding';

const STATUSES: readonly FindingStatus[] = ['new', 'reviewed', 'submitted', 'dismissed'];

const BLOCKER_FILTERS: readonly BlockerFilter[] = [
  'any',
  'none',
  'No proof of concept',
  'Exploitability not confirmed',
  'No written explanation',
  'No file location',
  'Attacker is out of scope for this program',
  'Post-script could not confirm the finding',
];

export interface FindingQueueFilters {
  severity?: string;
  maxBountyRank?: number;
  programId?: string;
  blocker?: BlockerFilter;
  ingest?: IngestBadge;
  decidedBy?: DecidedByFilter;
}

export interface ProgramOption {
  id: string;
  title: string;
}

export function parseFindingStatus(value: string | string[] | undefined): FindingStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
    ? (value as FindingStatus)
    : 'new';
}

function readString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNumber(value: string | string[] | undefined): number | undefined {
  const raw = readString(value);
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function parseFindingFilters(
  params: Record<string, string | string[] | undefined>,
): FindingQueueFilters {
  const filters: FindingQueueFilters = {};
  const severity = readString(params.severity);
  if (severity) filters.severity = severity;

  const maxBountyRank = readNumber(params.rank);
  if (maxBountyRank !== undefined) filters.maxBountyRank = maxBountyRank;

  const programId = readString(params.program);
  if (programId) filters.programId = programId;

  const blocker = readString(params.blocker);
  if (blocker && (BLOCKER_FILTERS as readonly string[]).includes(blocker)) {
    filters.blocker = blocker as BlockerFilter;
  }

  const ingest = readString(params.ingest);
  if (ingest === 'unseen' || ingest === 'updated' || ingest === 'seen') {
    filters.ingest = ingest;
  }

  const decidedBy = readString(params.decidedBy);
  if (decidedBy === 'operator' || decidedBy === 'auto' || decidedBy === 'ai') {
    filters.decidedBy = decidedBy;
  }

  return filters;
}

export function ingestBadge(finding: {
  viewedAt: string | null;
  fetchedAt: string;
}): IngestBadge {
  if (!finding.viewedAt) return 'unseen';
  return new Date(finding.fetchedAt) > new Date(finding.viewedAt) ? 'updated' : 'seen';
}

export interface QueuedFinding {
  id: string;
  status: FindingStatus;
  title: string;
  severity: string | null;
  impactLevel: string | null;
  vulnerabilityType: string | null;
  bountyRank: number | null;
  filePath: string | null;
  line: number | null;
  exploitable: boolean | null;
  minRewardUsd: number | null;
  maxRewardUsd: number | null;
  rankReasoning: string | null;
  repoKey: string;
  commitSha: string;
  programId: string;
  programTitle: string;
  programUrl: string;
  platform: string;
  permalink: string | null;
  report: string;
  krittReport: string | null;
  pocDiff: string | null;
  inScope: boolean | null;
  postScriptValid: boolean | null;
  blockers: string[];
  fetchedAt: string;
  viewedAt: string | null;
  ingestBadge: IngestBadge;
  decidedAt: string | null;
  decidedBy: string | null;
  triageReason: string | null;
  outcome: { id: string; result: string; payoutUsd: number | null } | null;
}

export interface FindingQueuePage {
  status: FindingStatus;
  counts: Record<FindingStatus, number>;
  filters: FindingQueueFilters;
  severities: string[];
  programs: ProgramOption[];
  findings: QueuedFinding[];
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function reportBlockers(finding: {
  maliciousInput: string | null;
  exploitable: boolean | null;
  explanation: string | null;
  filePath: string | null;
  pocDiff?: string | null;
  inScope?: boolean | null;
  postScriptValid?: boolean | null;
}): string[] {
  const blockers: string[] = [];
  if (!finding.pocDiff?.trim() && !finding.maliciousInput?.trim()) {
    blockers.push('No proof of concept');
  }
  if (finding.exploitable !== true) blockers.push('Exploitability not confirmed');
  if (!finding.explanation?.trim()) blockers.push('No written explanation');
  if (!finding.filePath?.trim()) blockers.push('No file location');
  if (finding.inScope === false) blockers.push('Attacker is out of scope for this program');
  if (finding.postScriptValid === false) blockers.push('Post-script could not confirm the finding');
  return blockers;
}

function matchesBlockerFilter(blockers: string[], filter: BlockerFilter | undefined): boolean {
  if (!filter || filter === 'any') return true;
  if (filter === 'none') return blockers.length === 0;
  return blockers.includes(filter);
}

function matchesIngestFilter(badge: IngestBadge, filter: IngestBadge | undefined): boolean {
  if (!filter) return true;
  return badge === filter;
}

export function filterHref(
  status: FindingStatus,
  current: FindingQueueFilters,
  patch: Partial<{
    severity: string | null;
    rank: number | null;
    program: string | null;
    blocker: BlockerFilter | null;
    ingest: IngestBadge | null;
    decidedBy: DecidedByFilter | null;
  }>,
): string {
  const params = new URLSearchParams();
  params.set('status', status);

  const severity = patch.severity !== undefined ? patch.severity : current.severity;
  const rank = patch.rank !== undefined ? patch.rank : current.maxBountyRank;
  const program = patch.program !== undefined ? patch.program : current.programId;
  const blocker = patch.blocker !== undefined ? patch.blocker : current.blocker;
  const ingest = patch.ingest !== undefined ? patch.ingest : current.ingest;
  const decidedBy = patch.decidedBy !== undefined ? patch.decidedBy : current.decidedBy;

  if (severity) params.set('severity', severity);
  if (rank !== undefined && rank !== null) params.set('rank', String(rank));
  if (program) params.set('program', program);
  if (blocker && blocker !== 'any') params.set('blocker', blocker);
  if (ingest) params.set('ingest', ingest);
  if (decidedBy) params.set('decidedBy', decidedBy);

  return `/findings?${params.toString()}`;
}

export async function listFindingQueue(
  prisma: PrismaClient,
  status: FindingStatus,
  filters: FindingQueueFilters = {},
): Promise<FindingQueuePage> {
  const [rows, grouped, programs] = await Promise.all([
    prisma.finding.findMany({
      where: {
        status,
        ...(filters.severity ? { severity: filters.severity } : {}),
        ...(filters.maxBountyRank !== undefined
          ? { bountyRank: { lte: filters.maxBountyRank } }
          : {}),
        ...(filters.programId
          ? { dispatch: { scope: { programId: filters.programId } } }
          : {}),
        ...(filters.decidedBy ? { decidedBy: filters.decidedBy } : {}),
      },
      include: {
        outcome: true,
        dispatch: { include: { scope: { include: { program: true } } } },
      },
      orderBy: [{ bountyRank: 'asc' }, { rank: 'asc' }, { fetchedAt: 'desc' }],
    }),
    prisma.finding.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.program.findMany({
      where: { scopes: { some: { dispatches: { some: { findings: { some: {} } } } } } },
      select: { id: true, title: true },
      orderBy: { title: 'asc' },
    }),
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

  const severities = new Set<string>();

  const mapped = rows.map((row): QueuedFinding => {
    const program = row.dispatch.scope.program;
    if (row.severity) severities.add(row.severity);

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

    const fetchedAt = row.fetchedAt.toISOString();
    const viewedAt = row.viewedAt?.toISOString() ?? null;

    return {
      id: row.id,
      status: row.status as FindingStatus,
      title: row.title,
      severity: row.severity,
      impactLevel: row.impactLevel,
      vulnerabilityType: row.vulnerabilityType,
      bountyRank: row.bountyRank,
      filePath: row.filePath,
      line: row.line,
      exploitable: row.exploitable,
      minRewardUsd: toNumber(row.minRewardUsd),
      maxRewardUsd: toNumber(row.maxRewardUsd),
      rankReasoning: row.rankReasoning,
      repoKey: row.dispatch.repoKey,
      commitSha: row.dispatch.commitSha,
      programId: program.id,
      programTitle: program.title,
      programUrl: program.url,
      platform: program.platform,
      permalink: findingPermalink(reportTarget, reportFinding),
      report: buildReport(reportFinding, reportTarget),
      krittReport: row.krittReport,
      pocDiff: row.pocDiff,
      inScope: row.inScope,
      postScriptValid: row.postScriptValid,
      blockers: reportBlockers(row),
      fetchedAt,
      viewedAt,
      ingestBadge: ingestBadge({ viewedAt, fetchedAt }),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decidedBy: row.decidedBy,
      triageReason: row.triageReason,
      outcome: row.outcome
        ? {
            id: row.outcome.id,
            result: row.outcome.result,
            payoutUsd: toNumber(row.outcome.payoutUsd),
          }
        : null,
    };
  });

  const findings = mapped.filter(
    (finding) =>
      matchesBlockerFilter(finding.blockers, filters.blocker) &&
      matchesIngestFilter(finding.ingestBadge, filters.ingest),
  );

  return {
    status,
    counts,
    filters,
    severities: [...severities].sort(),
    programs,
    findings,
  };
}
