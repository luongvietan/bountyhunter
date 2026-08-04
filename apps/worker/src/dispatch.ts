import { exclusionFor, type Exclusions, type Weights, score } from '@kritt-radar/core';
import type { PrismaClient } from '@kritt-radar/db';
import {
  KrittClient,
  KrittLaunchPolicyError,
  dispatchKey,
  planDispatch,
  summarizeSkips,
  type DispatchCandidate,
  type DispatchPlan,
} from '@kritt-radar/pipeline';

export interface DispatchConfig {
  maxScans: number;
  workflowId: string;
  postScriptId: string;
  apply: boolean;
}

export interface DispatchResult {
  plan: DispatchPlan;
  dispatched: number;
  failed: number;
  applied: boolean;
}

function changedFilesOf(evidence: unknown): number {
  if (typeof evidence !== 'object' || evidence === null) return 0;
  const files = (evidence as { files?: unknown }).files;
  return Array.isArray(files) ? files.length : 0;
}

function hasReason(evidence: unknown): boolean {
  return (
    typeof evidence === 'object' &&
    evidence !== null &&
    typeof (evidence as { reason?: unknown }).reason === 'string'
  );
}

export async function collectCandidates(
  prisma: PrismaClient,
  weights: Weights,
  exclusions: Exclusions,
  now: Date,
): Promise<DispatchCandidate[]> {
  const scopes = await prisma.scope.findMany({
    where: { kind: 'repo' },
    include: { program: true, signals: true },
  });

  return scopes.map((scope): DispatchCandidate => {
    const gap = scope.signals.find((signal) => signal.type === 'audit_gap');
    const verdict = exclusionFor(
      { hardKey: scope.hardKey, endsAt: scope.program.endsAt },
      exclusions,
      now,
    );

    return {
      scopeId: scope.id,
      repoKey: scope.hardKey ?? scope.repoUrl ?? scope.id,
      commitSha: scope.commitish,
      score: score(
        scope.signals.map((signal) => ({
          type: signal.type as never,
          value: signal.value,
          confidence: signal.confidence,
          evidence: {},
        })),
        weights,
      ).total,
      measuredAuditGap: gap !== undefined && gap.confidence > 0 && !hasReason(gap.evidence),
      changedFileCount: gap ? changedFilesOf(gap.evidence) : 0,
      excluded: verdict.excluded,
    };
  });
}

/**
 * Hand the top targets to Open-Kritt.
 *
 * Dry by default. Dispatching starts agent containers that spend real tokens,
 * so a run that was meant to be a preview must not be able to charge for one.
 */
export async function dispatchScans(
  prisma: PrismaClient,
  client: KrittClient,
  candidates: readonly DispatchCandidate[],
  config: DispatchConfig,
): Promise<DispatchResult> {
  const existing = await prisma.scanDispatch.findMany({
    select: { repoKey: true, commitSha: true },
  });
  const alreadyDispatched = new Set(
    existing.map((row) => dispatchKey(row.repoKey, row.commitSha)),
  );

  const plan = planDispatch(candidates, { maxScans: config.maxScans, alreadyDispatched });

  if (!config.apply) return { plan, dispatched: 0, failed: 0, applied: false };

  let dispatched = 0;
  let failed = 0;

  for (const target of plan.selected) {
    const commitSha = target.commitSha!;
    // Record before calling out, so a crash mid-request cannot lose the fact
    // that a scan may already be running and charging.
    const row = await prisma.scanDispatch.create({
      data: {
        scopeId: target.scopeId,
        repoKey: target.repoKey,
        commitSha,
        score: target.score,
        status: 'requested',
      },
    });

    try {
      const { scanId } = await client.createScan({
        repoFull: target.repoKey.replace(/^github\.com\//, ''),
        commitSha,
        workflowId: config.workflowId,
        postScriptId: config.postScriptId,
      });
      await prisma.scanDispatch.update({
        where: { id: row.id },
        data: { krittScanId: scanId, status: 'running' },
      });
      dispatched += 1;
    } catch (error) {
      const message =
        error instanceof KrittLaunchPolicyError
          ? 'Kritt refused the launch policy; another scan is running'
          : error instanceof Error
            ? error.message
            : String(error);
      await prisma.scanDispatch.update({
        where: { id: row.id },
        data: { status: 'error', error: message, finishedAt: new Date() },
      });
      failed += 1;
    }
  }

  return { plan, dispatched, failed, applied: true };
}

export function formatPlan(result: DispatchResult, config: DispatchConfig): string {
  const counts = summarizeSkips(result.plan);
  const mode = result.applied ? 'dispatched' : 'DRY RUN, nothing dispatched';
  const lines = [
    `[dispatch] ${mode}: ${result.plan.selected.length} selected of max ${config.maxScans}` +
      (result.applied ? ` / ${result.dispatched} accepted / ${result.failed} failed` : ''),
    `[dispatch] skipped: ${Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([reason, n]) => `${reason}=${n}`)
      .join(' ') || 'none'}`,
  ];
  for (const target of result.plan.selected) {
    lines.push(
      `  ${target.score.toFixed(1).padStart(5)}  ${target.repoKey} @ ${target.commitSha?.slice(0, 10)}  ${target.changedFileCount} files`,
    );
  }
  return lines.join('\n');
}
