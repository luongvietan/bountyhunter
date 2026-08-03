import type {
  AuditReport,
  Entity,
  MergeCandidate,
  PrismaClient,
  Program,
  Scope,
} from '@kritt-radar/db';
import { normalizeAuditHintKey } from './merge-decisions';

export type QueueStatus = 'pending' | 'approved' | 'rejected';

export interface QueueReport {
  firm: string;
  projectHint: string;
  publishedAt: string;
  reportUrl: string;
}

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
  newestReport: QueueReport | null;
}

export interface QueueApprovalEvidence {
  reportsMoved: number;
  aliasKeys: string[];
  newestReport: QueueReport | null;
}

export interface QueueCandidate {
  id: string;
  status: QueueStatus;
  similarity: number;
  tokenJaccard: number | null;
  editSimilarity: number | null;
  approvalEvidence: QueueApprovalEvidence | null;
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

type AuditHintAlias = { entityId: string; key: string };

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

function queueReport(value: unknown): QueueReport | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const report = value as Record<string, unknown>;
  if (
    typeof report.firm !== 'string'
    || typeof report.projectHint !== 'string'
    || typeof report.publishedAt !== 'string'
    || typeof report.reportUrl !== 'string'
    || !Number.isFinite(Date.parse(report.publishedAt))
  ) return null;
  return {
    firm: report.firm,
    projectHint: report.projectHint,
    publishedAt: new Date(report.publishedAt).toISOString(),
    reportUrl: report.reportUrl,
  };
}

function approvalEvidence(reason: unknown): QueueApprovalEvidence | null {
  if (typeof reason !== 'object' || reason === null || Array.isArray(reason)) return null;
  const raw = (reason as Record<string, unknown>).approvalEvidence;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const evidence = raw as Record<string, unknown>;
  if (
    typeof evidence.reportsMoved !== 'number'
    || !Number.isSafeInteger(evidence.reportsMoved)
    || evidence.reportsMoved < 0
    || !Array.isArray(evidence.aliasKeys)
    || evidence.aliasKeys.some((key) => typeof key !== 'string' || key.length === 0)
  ) return null;
  const newestReport = evidence.newestReport === null ? null : queueReport(evidence.newestReport);
  if (evidence.newestReport !== null && newestReport === null) return null;
  return {
    reportsMoved: evidence.reportsMoved,
    aliasKeys: stableUnique(evidence.aliasKeys as string[]),
    newestReport,
  };
}

function projectEntity(entity: EntityWithEvidence): QueueEntity {
  const newestReport = entity.auditReports.reduce((newest, report) => {
    if (newest === null || report.publishedAt > newest.publishedAt) return report;
    if (report.publishedAt.getTime() === newest.publishedAt.getTime() && report.id < newest.id) {
      return report;
    }
    return newest;
  }, null as AuditReport | null);
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
    newestReport: newestReport === null
      ? null
      : {
          firm: newestReport.firm,
          projectHint: newestReport.projectHint,
          publishedAt: newestReport.publishedAt.toISOString(),
          reportUrl: newestReport.reportUrl,
        },
  };
}

function approvalBlock(
  source: QueueEntity,
  target: QueueEntity,
  rawProjectHints: readonly string[],
  auditHintAliases: readonly AuditHintAlias[],
): string | null {
  if (source.auditReportCount === 0) return 'Provisional entity has no audit reports to merge.';
  const aliasKeys = rawProjectHints.map(normalizeAuditHintKey);
  if (aliasKeys.some((key) => key.length === 0)) {
    return 'Audit report project hints must not be empty.';
  }
  const relevantKeys = new Set(aliasKeys);
  if (auditHintAliases.some((alias) => relevantKeys.has(alias.key) && alias.entityId !== target.id)) {
    return 'An audit hint alias belongs to another entity.';
  }
  return null;
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
  const [candidates, groupedCounts, auditHintAliases] = await Promise.all([
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
    prisma.entityAlias.findMany({
      where: { kind: 'audit_hint' },
      select: { entityId: true, key: true },
    }),
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
      const candidateStatus = parseQueueStatus(candidate.status);
      const provisionalEvidence = left.provisional ? candidate.leftEntity : candidate.rightEntity;
      const blockedReason = candidateStatus === 'pending' && roles.source && roles.target
        ? approvalBlock(
            roles.source,
            roles.target,
            provisionalEvidence.auditReports.map((report) => report.projectHint),
            auditHintAliases,
          )
        : roles.blockedReason;

      return {
        id: candidate.id,
        status: candidateStatus,
        similarity: candidate.similarity,
        tokenJaccard: finiteScore(candidate.reason, 'tokenJaccard'),
        editSimilarity: finiteScore(candidate.reason, 'editSimilarity'),
        approvalEvidence: approvalEvidence(candidate.reason),
        createdAt: candidate.createdAt.toISOString(),
        decidedAt: candidate.decidedAt?.toISOString() ?? null,
        source: roles.source,
        target: roles.target,
        approvable: candidateStatus === 'pending' && blockedReason === null,
        blockedReason: candidateStatus === 'pending' ? blockedReason : null,
      };
    }),
  };
}
