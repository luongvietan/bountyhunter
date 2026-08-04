import {
  githubRepoSnapshotSourceKey,
  type RepoSnapshotPayload,
  type RepoTarget,
} from '@kritt-radar/collectors';
import { normalizeRepoUrl, type SignalValue } from '@kritt-radar/core';
import type { Prisma, PrismaClient } from '@kritt-radar/db';
import { z } from 'zod';
import { extractAuditGap, type AuditCoverage } from './extractors/audit-gap.js';

/** Các collector có thể cung cấp bằng chứng "repo này đã được audit". */
const AUDIT_SOURCE_COLLECTORS = ['audit-report-repos'];

/**
 * Đã có nguồn audit nào chạy thành công chưa.
 *
 * Nếu chưa, `lastAuditAt = null` trên mọi scope chỉ phản ánh việc ta chưa đi
 * tìm, không phải việc repo chưa được audit — và audit_gap phải im lặng thay vì
 * chấm điểm tối đa cho tất cả.
 */
export async function resolveAuditCoverage(prisma: PrismaClient): Promise<AuditCoverage> {
  const ok = await prisma.collectorRun.findFirst({
    where: { collectorId: { in: AUDIT_SOURCE_COLLECTORS }, status: 'ok' },
    select: { id: true },
  });
  return ok ? 'searched' : 'unsearched';
}

const ESTIMATED_LOC_CONFIDENCE = 0.7;
const TRUNCATED_CONFIDENCE_CAP = 0.35;
const NonEmptyString = z.string().min(1);

const RepoSnapshotSchema = z.object({
  repoKey: NonEmptyString,
  cutoff: z.object({
    lastAuditAt: z.string().datetime({ offset: true }).nullable(),
    baseCommit: NonEmptyString.nullable(),
  }),
  headSha: NonEmptyString.nullable(),
  headAuthoredAt: z.string().datetime({ offset: true }).nullable(),
  files: z.array(NonEmptyString),
  totalLoc: z.number().finite().int().nonnegative(),
  locMethod: z.literal('estimated_from_bytes'),
  changedFiles: z.array(
    z.object({ path: NonEmptyString, changedLoc: z.number().finite().int().nonnegative() }),
  ),
  commits: z.array(NonEmptyString),
  auditPredatesRepo: z.boolean().default(false),
  complete: z.boolean(),
  truncated: z.boolean(),
  error: z.string().nullable(),
}).superRefine((snapshot, ctx) => {
  if ((snapshot.headSha === null) !== (snapshot.headAuthoredAt === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['headAuthoredAt'],
      message: 'HEAD SHA and authored date must both be present or both be null',
    });
  }

  if (snapshot.complete && snapshot.truncated) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['complete'],
      message: 'complete and truncated cannot both be true',
    });
  }

  if (snapshot.auditPredatesRepo) {
    if (snapshot.cutoff.lastAuditAt === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['auditPredatesRepo'],
        message: 'auditPredatesRepo requires an audit date',
      });
    }
    if (snapshot.cutoff.baseCommit !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cutoff', 'baseCommit'],
        message: 'auditPredatesRepo snapshots cannot carry a base commit',
      });
    }
  }

  if (snapshot.error !== null) {
    if (snapshot.complete) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['complete'],
        message: 'failed snapshots cannot be complete',
      });
    }
    return;
  }

  if (snapshot.headSha === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['headSha'],
      message: 'healthy snapshots require a HEAD SHA',
    });
  }
  if (!snapshot.complete && !snapshot.truncated) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['complete'],
      message: 'healthy snapshots must be complete or truncated',
    });
  }
  if (
    snapshot.cutoff.lastAuditAt !== null &&
    snapshot.cutoff.baseCommit === null &&
    !snapshot.auditPredatesRepo
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cutoff', 'baseCommit'],
      message: 'healthy audited snapshots require a base commit',
    });
  }
});

export interface RepoTargetRecord extends RepoTarget {
  scopeId: string;
  auditObservationIds: string[];
}

function cutoffMatches(snapshot: RepoSnapshotPayload, expected: RepoTarget): boolean {
  if (snapshot.repoKey !== expected.repoKey) return false;
  if (snapshot.cutoff.lastAuditAt !== expected.lastAuditAt) return false;
  if (expected.coveredCommit !== null) {
    return snapshot.cutoff.baseCommit === expected.coveredCommit;
  }
  if (expected.lastAuditAt === null) return snapshot.cutoff.baseCommit === null;
  return true;
}

function evidenceBase(
  snapshot: RepoSnapshotPayload,
  expected: RepoTarget,
  useSnapshotChanges: boolean,
): Record<string, unknown> {
  const audited = expected.lastAuditAt !== null;
  const wholeRepoUnaudited = snapshot.auditPredatesRepo;
  const files = useSnapshotChanges
    ? audited
      ? wholeRepoUnaudited
        ? snapshot.files
        : snapshot.changedFiles.map((file) => file.path)
      : snapshot.files
    : [];
  const changedLoc = useSnapshotChanges && audited
    ? wholeRepoUnaudited
      ? snapshot.totalLoc
      : snapshot.changedFiles.reduce((total, file) => total + file.changedLoc, 0)
    : 0;

  return {
    headSha: snapshot.headSha,
    sinceCommit: snapshot.cutoff.baseCommit,
    sinceDate: snapshot.cutoff.lastAuditAt,
    files,
    commits: useSnapshotChanges && audited
      ? wholeRepoUnaudited
        ? snapshot.headSha === null
          ? []
          : [snapshot.headSha]
        : snapshot.commits
      : [],
    changedLoc,
    totalLoc: snapshot.totalLoc,
    locMethod: snapshot.locMethod,
    complete: snapshot.complete,
    truncated: snapshot.truncated,
    ...(wholeRepoUnaudited ? { auditPredatesRepo: true } : {}),
  };
}

export function snapshotToAuditGap(
  snapshot: RepoSnapshotPayload,
  expected: RepoTarget,
  auditCoverage: AuditCoverage = 'unsearched',
): SignalValue {
  if (!RepoSnapshotSchema.safeParse(snapshot).success) {
    return noDataSignal(expected, 'invalid_snapshot');
  }

  if (!cutoffMatches(snapshot, expected)) {
    return {
      type: 'audit_gap',
      value: 0,
      confidence: 0,
      evidence: { ...evidenceBase(snapshot, expected, false), reason: 'stale_cutoff' },
    };
  }

  if (snapshot.error !== null || (!snapshot.complete && !snapshot.truncated)) {
    return {
      type: 'audit_gap',
      value: 0,
      confidence: 0,
      evidence: {
        ...evidenceBase(snapshot, expected, false),
        reason: 'snapshot_failed',
        ...(snapshot.error === null ? {} : { error: snapshot.error }),
      },
    };
  }

  const lastAuditAt = expected.lastAuditAt === null ? null : new Date(expected.lastAuditAt);
  // Audit older than the repo's first commit ⇒ every in-scope file is unreviewed.
  // Attribute the whole estimated LOC to the first file so the log ratio is 1
  // without inventing a fake compare response in the collector.
  const wholeRepoChanges = snapshot.auditPredatesRepo
    ? {
        files: snapshot.files.map((path, index) => ({
          path,
          changedLoc: index === 0 ? snapshot.totalLoc : 0,
        })),
        commits: snapshot.headSha === null ? [] : [snapshot.headSha],
      }
    : {
        files: snapshot.changedFiles,
        commits: snapshot.commits,
      };
  const calculated = extractAuditGap({
    commits: [],
    lastAuditAt,
    pathGlobs: expected.pathGlobs,
    totalLoc: snapshot.totalLoc,
    hasCommitData: true,
    auditCoverage,
    ...(lastAuditAt === null ? {} : { changesSinceAudit: wholeRepoChanges }),
  });
  // Lấy min chứ không ghi đè: chất lượng snapshot và độ chắc chắn của chính
  // extractor là hai nguồn nghi ngờ độc lập, cái nào yếu hơn thì quyết định.
  // Ghi đè thẳng sẽ nuốt mất confidence 0 của nhánh "chưa quét audit".
  const snapshotConfidence = snapshot.truncated
    ? Math.min(ESTIMATED_LOC_CONFIDENCE, TRUNCATED_CONFIDENCE_CAP)
    : ESTIMATED_LOC_CONFIDENCE;
  const confidence = Math.min(snapshotConfidence, calculated.confidence);

  return {
    type: calculated.type,
    value: calculated.value,
    confidence,
    evidence: {
      ...evidenceBase(snapshot, expected, true),
      ...(lastAuditAt === null
        ? {}
        : {
            files: calculated.evidence.files,
            commits: calculated.evidence.commits,
            changedLoc: calculated.evidence.changedLoc,
          }),
      ...(calculated.evidence.reason === undefined
        ? {}
        : { reason: calculated.evidence.reason }),
    },
  };
}

type ScopeAuditReport = {
  publishedAt: Date;
  coveredCommit: string | null;
  observationIds: string[];
  projectHint: string;
  reportUrl: string;
};

/**
 * Chọn audit report khớp repo khi entity có nhiều report (Sherlock multi-repo).
 * Ưu tiên projectHint hoặc reportUrl chứa repoKey khi có coveredCommit.
 */
export function pickAuditReportForRepo(
  reports: readonly ScopeAuditReport[],
  repoKey: string,
): ScopeAuditReport | null {
  if (reports.length === 0) return null;
  const withCommit = reports.filter((report) => report.coveredCommit);
  const byHint = withCommit.find((report) => report.projectHint === repoKey);
  if (byHint) return byHint;
  const encoded = encodeURIComponent(repoKey);
  const shortKey = repoKey.replace(/^github\.com\//, '');
  const byUrl = withCommit.find(
    (report) => report.reportUrl.includes(encoded) || report.reportUrl.includes(shortKey),
  );
  if (byUrl) return byUrl;
  return reports[0]!;
}

export async function listRepoTargets(prisma: PrismaClient): Promise<RepoTargetRecord[]> {
  const scopes = await prisma.scope.findMany({
    where: { kind: 'repo', hardKey: { not: null } },
    select: {
      id: true,
      hardKey: true,
      repoUrl: true,
      pathGlobs: true,
      program: {
        select: {
          entity: {
            select: {
              auditReports: {
                orderBy: [{ publishedAt: 'desc' }, { reportUrl: 'asc' }, { id: 'asc' }],
                select: {
                  publishedAt: true,
                  coveredCommit: true,
                  observationIds: true,
                  projectHint: true,
                  reportUrl: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { id: 'asc' },
  });

  const targets: RepoTargetRecord[] = [];
  for (const scope of scopes) {
    const repoKey = normalizeRepoUrl(scope.hardKey ?? scope.repoUrl ?? '');
    if (!repoKey?.startsWith('github.com/')) continue;
    const reports = scope.program.entity?.auditReports ?? [];
    const report = pickAuditReportForRepo(reports, repoKey);
    targets.push({
      scopeId: scope.id,
      repoKey,
      pathGlobs: scope.pathGlobs,
      lastAuditAt: report?.publishedAt.toISOString() ?? null,
      coveredCommit: report?.coveredCommit ?? null,
      auditObservationIds: report?.observationIds ?? [],
    });
  }
  return targets;
}

function isUsableSnapshot(
  snapshot: RepoSnapshotPayload,
): snapshot is RepoSnapshotPayload & { error: null; headSha: string } {
  return (
    snapshot.error === null &&
    snapshot.headSha !== null &&
    (snapshot.complete || snapshot.truncated)
  );
}

function noDataSignal(target: RepoTarget, reason: string, error?: string): SignalValue {
  return {
    type: 'audit_gap',
    value: 0,
    confidence: 0,
    evidence: {
      headSha: null,
      sinceCommit: target.coveredCommit,
      sinceDate: target.lastAuditAt,
      files: [],
      commits: [],
      changedLoc: 0,
      totalLoc: 0,
      locMethod: 'estimated_from_bytes',
      complete: false,
      truncated: false,
      reason,
      ...(error === undefined ? {} : { error }),
    },
  };
}

export async function materializeRepoSignals(
  prisma: PrismaClient,
  now: Date,
): Promise<{ scopes: number; noData: number; auditCoverage: AuditCoverage }> {
  const auditCoverage = await resolveAuditCoverage(prisma);
  const targets = await listRepoTargets(prisma);
  const sourceUrls = [...new Set(targets.map(githubRepoSnapshotSourceKey))];
  const observations = sourceUrls.length === 0
    ? []
    : await prisma.observation.findMany({
        where: {
          collectorId: 'github-repo-snapshot',
          sourceUrl: { in: sourceUrls },
        },
        select: { id: true, sourceUrl: true, fetchedAt: true, payload: true },
      });
  const latestBySource = new Map<string, (typeof observations)[number]>();
  for (const observation of observations) {
    const current = latestBySource.get(observation.sourceUrl);
    if (
      !current ||
      observation.fetchedAt.getTime() > current.fetchedAt.getTime() ||
      (observation.fetchedAt.getTime() === current.fetchedAt.getTime() && observation.id > current.id)
    ) {
      latestBySource.set(observation.sourceUrl, observation);
    }
  }

  let noData = 0;
  for (const target of targets) {
    const observation = latestBySource.get(githubRepoSnapshotSourceKey(target));
    const parsed = observation ? RepoSnapshotSchema.safeParse(observation.payload) : null;
    const snapshot: RepoSnapshotPayload | null = parsed?.success ? parsed.data : null;
    const signal = snapshot
      ? snapshotToAuditGap(snapshot, target, auditCoverage)
      : noDataSignal(
          target,
          observation ? 'invalid_snapshot' : 'no_snapshot',
          parsed && !parsed.success ? parsed.error.issues[0]?.message : undefined,
        );
    if (signal.confidence === 0) noData += 1;
    const observationIds = [
      ...new Set([...target.auditObservationIds, ...(observation ? [observation.id] : [])]),
    ];

    await prisma.$transaction(async (tx) => {
      if (snapshot && isUsableSnapshot(snapshot)) {
        await tx.scope.update({ where: { id: target.scopeId }, data: { commitish: snapshot.headSha } });
      }
      await tx.signal.upsert({
        where: { scopeId_type: { scopeId: target.scopeId, type: signal.type } },
        create: {
          scopeId: target.scopeId,
          type: signal.type,
          value: signal.value,
          confidence: signal.confidence,
          evidence: signal.evidence as Prisma.InputJsonValue,
          observationIds,
          computedAt: now,
        },
        update: {
          value: signal.value,
          confidence: signal.confidence,
          evidence: signal.evidence as Prisma.InputJsonValue,
          observationIds,
          computedAt: now,
        },
      });
    });
  }

  return { scopes: targets.length, noData, auditCoverage };
}
