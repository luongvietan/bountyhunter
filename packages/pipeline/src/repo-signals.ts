import type { RepoSnapshotPayload, RepoTarget } from '@kritt-radar/collectors';
import { normalizeRepoUrl, type SignalValue } from '@kritt-radar/core';
import type { Prisma, PrismaClient } from '@kritt-radar/db';
import { z } from 'zod';
import { extractAuditGap } from './extractors/audit-gap.js';

const ESTIMATED_LOC_CONFIDENCE = 0.7;
const TRUNCATED_CONFIDENCE_CAP = 0.35;

const RepoSnapshotSchema = z.object({
  repoKey: z.string(),
  cutoff: z.object({
    lastAuditAt: z.string().nullable(),
    baseCommit: z.string().nullable(),
  }),
  headSha: z.string().nullable(),
  headAuthoredAt: z.string().nullable(),
  files: z.array(z.string()),
  totalLoc: z.number().finite().nonnegative(),
  locMethod: z.literal('estimated_from_bytes'),
  changedFiles: z.array(
    z.object({ path: z.string(), changedLoc: z.number().finite().nonnegative() }),
  ),
  commits: z.array(z.string()),
  complete: z.boolean(),
  truncated: z.boolean(),
  error: z.string().nullable(),
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
  const files = useSnapshotChanges
    ? audited
      ? snapshot.changedFiles.map((file) => file.path)
      : snapshot.files
    : [];
  const changedLoc = useSnapshotChanges && audited
    ? snapshot.changedFiles.reduce((total, file) => total + file.changedLoc, 0)
    : 0;

  return {
    headSha: snapshot.headSha,
    sinceCommit: snapshot.cutoff.baseCommit,
    sinceDate: snapshot.cutoff.lastAuditAt,
    files,
    commits: useSnapshotChanges && audited ? snapshot.commits : [],
    changedLoc,
    totalLoc: snapshot.totalLoc,
    locMethod: snapshot.locMethod,
    complete: snapshot.complete,
    truncated: snapshot.truncated,
  };
}

export function snapshotToAuditGap(
  snapshot: RepoSnapshotPayload,
  expected: RepoTarget,
): SignalValue {
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
  const calculated = extractAuditGap({
    commits: [],
    lastAuditAt,
    pathGlobs: expected.pathGlobs,
    totalLoc: snapshot.totalLoc,
    hasCommitData: true,
    ...(lastAuditAt === null
      ? {}
      : {
          changesSinceAudit: {
            files: snapshot.changedFiles,
            commits: snapshot.commits,
          },
        }),
  });
  const confidence = snapshot.truncated
    ? Math.min(ESTIMATED_LOC_CONFIDENCE, TRUNCATED_CONFIDENCE_CAP)
    : ESTIMATED_LOC_CONFIDENCE;

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
                take: 1,
                select: {
                  publishedAt: true,
                  coveredCommit: true,
                  observationIds: true,
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
    const report = scope.program.entity?.auditReports[0];
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

function snapshotSourceUrl(repoKey: string): string {
  const [, owner, repository] = repoKey.split('/');
  return `https://api.github.com/repos/${encodeURIComponent(owner!)}/${encodeURIComponent(repository!)}`;
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
): Promise<{ scopes: number; noData: number }> {
  const targets = await listRepoTargets(prisma);
  const sourceUrls = [...new Set(targets.map(({ repoKey }) => snapshotSourceUrl(repoKey)))];
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
    const observation = latestBySource.get(snapshotSourceUrl(target.repoKey));
    const parsed = observation ? RepoSnapshotSchema.safeParse(observation.payload) : null;
    const snapshot: RepoSnapshotPayload | null = parsed?.success ? parsed.data : null;
    const signal = snapshot
      ? snapshotToAuditGap(snapshot, target)
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
      if (snapshot?.headSha !== null && snapshot?.headSha !== undefined) {
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

  return { scopes: targets.length, noData };
}
