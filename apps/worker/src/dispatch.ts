import { exclusionFor, type Exclusions, type Weights, score } from '@kritt-radar/core';
import type { PrismaClient } from '@kritt-radar/db';
import {
  KrittClient,
  KrittLaunchPolicyError,
  buildRepoScope,
  dispatchKey,
  planDispatch,
  scopeConfiguration,
  selectScopeFiles,
  summarizeSkips,
  type DispatchCandidate,
  type DispatchPlan,
} from '@kritt-radar/pipeline';
import { buildScanRequest } from './scan-request.js';

export interface DispatchConfig {
  maxScans: number;
  workflowId: string;
  postScriptId: string;
  /** Post-script chain in run order; postScriptId is its first entry. */
  postScriptIds: string[];
  apply: boolean;
  model: string;
  harness: string;
  modelProvider: string;
  thinkingEffort: string;
  severityRanker: string;
  severityRankerId?: string;
  scopeFileLimit: number;
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

function scopeFilesOf(evidence: unknown): string[] {
  if (typeof evidence !== 'object' || evidence === null) return [];
  const files = (evidence as { files?: unknown }).files;
  if (!Array.isArray(files)) return [];
  return files.filter((file): file is string => typeof file === 'string');
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
  scopeFileLimit: number,
): Promise<DispatchCandidate[]> {
  const scopes = await prisma.scope.findMany({
    where: { kind: 'repo' },
    include: { program: true, signals: true },
  });

  return scopes.map((scope): DispatchCandidate => {
    const gap = scope.signals.find((signal) => signal.type === 'audit_gap');
    const allFiles = gap ? scopeFilesOf(gap.evidence) : [];
    const verdict = exclusionFor(
      { hardKey: scope.hardKey, endsAt: scope.program.endsAt },
      exclusions,
      now,
    );

    return {
      scopeId: scope.id,
      repoKey: scope.hardKey ?? scope.repoUrl ?? scope.id,
      commitSha: scope.commitish,
      programUrl: scope.program.url,
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
      scopeFiles: selectScopeFiles(allFiles, { limit: scopeFileLimit }),
      excluded: verdict.excluded,
    };
  });
}

export async function dispatchScans(
  prisma: PrismaClient,
  client: KrittClient,
  candidates: readonly DispatchCandidate[],
  config: DispatchConfig,
): Promise<DispatchResult> {
  const existing = await prisma.scanDispatch.findMany({
    where: { status: { not: 'error' } },
    select: { repoKey: true, commitSha: true },
  });
  const alreadyDispatched = new Set(
    existing.map((row) => dispatchKey(row.repoKey, row.commitSha)),
  );

  const plan = planDispatch(candidates, { maxScans: config.maxScans, alreadyDispatched });

  if (!config.apply) return { plan, dispatched: 0, failed: 0, applied: false };

  const severityRanker =
    config.severityRanker.trim() ||
    (await client.severityRanker(config.severityRankerId)).content;

  let dispatched = 0;
  let failed = 0;

  for (const target of plan.selected) {
    const commitSha = target.commitSha!;
    const scopeFiles = target.scopeFiles ?? [];
    const repoScope =
      scopeFiles.length > 0
        ? buildRepoScope(scopeFiles, target.changedFileCount)
        : undefined;
    const configuration =
      scopeFiles.length > 0
        ? scopeConfiguration(scopeFiles, config.scopeFileLimit)
        : undefined;

    const row = await prisma.scanDispatch.upsert({
      where: { repoKey_commitSha: { repoKey: target.repoKey, commitSha } },
      create: {
        scopeId: target.scopeId,
        repoKey: target.repoKey,
        commitSha,
        score: target.score,
        status: 'requested',
        providerUsed: config.modelProvider,
        scopeFileCount: scopeFiles.length > 0 ? scopeFiles.length : null,
      },
      update: {
        scopeId: target.scopeId,
        score: target.score,
        status: 'requested',
        error: null,
        krittScanId: null,
        finishedAt: null,
        providerUsed: config.modelProvider,
        scopeFileCount: scopeFiles.length > 0 ? scopeFiles.length : null,
      },
    });

    try {
      const { scanId } = await client.createScan(
        buildScanRequest(
          {
            repoFull: target.repoKey.replace(/^github\.com\//, ''),
            commitSha,
            workflowId: config.workflowId,
            postScriptId: config.postScriptId,
            postScriptIds: config.postScriptIds,
            model: config.model,
            harness: config.harness,
            modelProvider: config.modelProvider,
            thinkingEffort: config.thinkingEffort,
            severityRanker,
            // The scope post-script asks whether this attacker is eligible, and
            // it can only answer against the program's own rules page.
            extra: { bug_bounty_url: target.programUrl },
          },
          repoScope,
          configuration,
        ),
      );
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
    const handoff = target.scopeFiles?.length
      ? `${target.scopeFiles.length}/${target.changedFileCount} files handoff`
      : `${target.changedFileCount} files`;
    lines.push(
      `  ${target.score.toFixed(1).padStart(5)}  ${target.repoKey} @ ${target.commitSha?.slice(0, 10)}  ${handoff}`,
    );
  }
  return lines.join('\n');
}
