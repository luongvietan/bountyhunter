import type {
  AuditReport,
  Entity,
  MergeCandidate,
  PrismaClient,
  Program,
  Scope,
} from '@kritt-radar/db';

export type QueueStatus = 'pending' | 'approved' | 'rejected';

export interface QueueEntity {
  id: string;
  slug: string;
  canonicalName: string;
  provisional: boolean;
  auditReportCount: number;
  projectHints: string[];
  auditFirms: string[];
  programCount: number;
  platforms: string[];
  programTitles: string[];
  repoScopes: string[];
}

export interface QueueCandidate {
  id: string;
  status: QueueStatus;
  similarity: number;
  tokenJaccard: number | null;
  editSimilarity: number | null;
  createdAt: string;
  decidedAt: string | null;
  source: QueueEntity | null;
  target: QueueEntity | null;
  approvable: boolean;
  blockedReason: string | null;
}

export interface MergeQueuePage {
  status: QueueStatus;
  counts: Record<QueueStatus, number>;
  candidates: QueueCandidate[];
}

const queueStatuses: readonly QueueStatus[] = ['pending', 'approved', 'rejected'];

type EntityWithEvidence = Entity & {
  auditReports: AuditReport[];
  programs: Array<Program & { scopes: Scope[] }>;
};

type CandidateWithEvidence = MergeCandidate & {
  leftEntity: EntityWithEvidence;
  rightEntity: EntityWithEvidence;
};

function isQueueStatus(value: string): value is QueueStatus {
  return queueStatuses.includes(value as QueueStatus);
}

function stableUnique(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    if (value === null || value === undefined || value === '' || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }

  return unique;
}

function finiteScore(reason: unknown, key: 'tokenJaccard' | 'editSimilarity'): number | null {
  if (typeof reason !== 'object' || reason === null || Array.isArray(reason)) return null;
  const value = (reason as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function projectEntity(entity: EntityWithEvidence): QueueEntity {
  return {
    id: entity.id,
    slug: entity.slug,
    canonicalName: entity.canonicalName,
    provisional: entity.programs.length === 0,
    auditReportCount: entity.auditReports.length,
    projectHints: stableUnique(entity.auditReports.map((report) => report.projectHint)),
    auditFirms: stableUnique(entity.auditReports.map((report) => report.firm)),
    programCount: entity.programs.length,
    platforms: stableUnique(entity.programs.map((program) => program.platform)),
    programTitles: stableUnique(entity.programs.map((program) => program.title)),
    repoScopes: stableUnique(
      entity.programs.flatMap((program) =>
        program.scopes.filter((scope) => scope.kind === 'repo').map((scope) => scope.hardKey),
      ),
    ),
  };
}

export function parseQueueStatus(value: string | string[] | undefined): QueueStatus {
  return typeof value === 'string' && isQueueStatus(value) ? value : 'pending';
}

export function inferCandidateRoles(left: QueueEntity, right: QueueEntity): {
  source: QueueEntity | null;
  target: QueueEntity | null;
  blockedReason: string | null;
} {
  if (left.provisional === right.provisional) {
    return {
      source: null,
      target: null,
      blockedReason: 'Candidate requires exactly one provisional entity.',
    };
  }

  return left.provisional
    ? { source: left, target: right, blockedReason: null }
    : { source: right, target: left, blockedReason: null };
}

export async function listMergeQueue(
  prisma: PrismaClient,
  status: QueueStatus,
): Promise<MergeQueuePage> {
  const [candidates, groupedCounts] = await Promise.all([
    prisma.mergeCandidate.findMany({
      where: { status },
      orderBy: [{ similarity: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      include: {
        leftEntity: {
          include: {
            auditReports: { orderBy: { id: 'asc' } },
            programs: { include: { scopes: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } },
          },
        },
        rightEntity: {
          include: {
            auditReports: { orderBy: { id: 'asc' } },
            programs: { include: { scopes: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } },
          },
        },
      },
    }),
    prisma.mergeCandidate.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const counts: Record<QueueStatus, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const group of groupedCounts) {
    if (isQueueStatus(group.status)) counts[group.status] = group._count._all;
  }

  return {
    status,
    counts,
    candidates: (candidates as CandidateWithEvidence[]).map((candidate) => {
      const left = projectEntity(candidate.leftEntity);
      const right = projectEntity(candidate.rightEntity);
      const roles = inferCandidateRoles(left, right);

      return {
        id: candidate.id,
        status: parseQueueStatus(candidate.status),
        similarity: candidate.similarity,
        tokenJaccard: finiteScore(candidate.reason, 'tokenJaccard'),
        editSimilarity: finiteScore(candidate.reason, 'editSimilarity'),
        createdAt: candidate.createdAt.toISOString(),
        decidedAt: candidate.decidedAt?.toISOString() ?? null,
        source: roles.source,
        target: roles.target,
        approvable: roles.blockedReason === null,
        blockedReason: roles.blockedReason,
      };
    }),
  };
}
