import type { PrismaClient } from '@kritt-radar/db';
import {
  KrittClient,
  KrittLaunchPolicyError,
  buildRepoScope,
  modelConfigForRetry,
  scopeConfiguration,
  selectScopeFiles,
} from '@kritt-radar/pipeline';
import type { DispatchConfig } from './dispatch.js';
import { buildScanRequest } from './scan-request.js';

export interface RetryConfig extends DispatchConfig {
  scopeFileLimit: number;
  fallbackModel?: string;
  fallbackHarness?: string;
  fallbackModelProvider?: string;
  fallbackThinkingEffort?: string;
}

export interface RetryResult {
  attempted: number;
  relaunched: number;
  failed: number;
}

function scopeFilesOf(evidence: unknown): string[] {
  if (typeof evidence !== 'object' || evidence === null) return [];
  const files = (evidence as { files?: unknown }).files;
  if (!Array.isArray(files)) return [];
  return files.filter((file): file is string => typeof file === 'string');
}

/**
 * Re-dispatch scans Kritt marked failed/stopped. First retry keeps the primary
 * provider; the second uses KRITT_FALLBACK_* when configured.
 */
export async function retryFailedDispatches(
  prisma: PrismaClient,
  client: KrittClient,
  config: RetryConfig,
): Promise<RetryResult> {
  const failed = await prisma.scanDispatch.findMany({
    where: { status: 'error', retryCount: { lt: 2 } },
    include: { scope: { include: { signals: true, program: true } } },
    orderBy: { updatedAt: 'asc' },
  });

  const result: RetryResult = { attempted: failed.length, relaunched: 0, failed: 0 };
  if (failed.length === 0) return result;

  const severityRanker =
    config.severityRanker.trim() ||
    (await client.severityRanker(config.severityRankerId)).content;

  for (const dispatch of failed) {
    const model = modelConfigForRetry(config, dispatch.retryCount);
    if (model.fallback && !config.fallbackModelProvider) {
      result.failed += 1;
      continue;
    }

    const gap = dispatch.scope.signals.find((signal) => signal.type === 'audit_gap');
    const allFiles = gap ? scopeFilesOf(gap.evidence) : [];
    const scopeFiles = selectScopeFiles(allFiles, { limit: config.scopeFileLimit });
    const repoScope =
      scopeFiles.length > 0 ? buildRepoScope(scopeFiles, allFiles.length) : undefined;
    const configuration =
      scopeFiles.length > 0
        ? scopeConfiguration(scopeFiles, config.scopeFileLimit)
        : undefined;

    await prisma.scanDispatch.update({
      where: { id: dispatch.id },
      data: {
        status: 'requested',
        error: null,
        krittScanId: null,
        finishedAt: null,
        retryCount: dispatch.retryCount + 1,
        providerUsed: model.modelProvider,
        scopeFileCount: scopeFiles.length > 0 ? scopeFiles.length : dispatch.scopeFileCount,
      },
    });

    try {
      const { scanId } = await client.createScan(
        buildScanRequest(
          {
            repoFull: dispatch.repoKey.replace(/^github\.com\//, ''),
            commitSha: dispatch.commitSha,
            workflowId: config.workflowId,
            postScriptId: config.postScriptId,
            postScriptIds: config.postScriptIds,
            model: model.model,
            harness: model.harness,
            modelProvider: model.modelProvider,
            thinkingEffort: model.thinkingEffort,
            severityRanker,
            extra: { bug_bounty_url: dispatch.scope.program.url },
          },
          repoScope,
          configuration,
        ),
      );
      await prisma.scanDispatch.update({
        where: { id: dispatch.id },
        data: { krittScanId: scanId, status: 'running' },
      });
      result.relaunched += 1;
    } catch (error) {
      const message =
        error instanceof KrittLaunchPolicyError
          ? 'Kritt refused the launch policy; another scan is running'
          : error instanceof Error
            ? error.message
            : String(error);
      await prisma.scanDispatch.update({
        where: { id: dispatch.id },
        data: { status: 'error', error: message, finishedAt: new Date() },
      });
      result.failed += 1;
    }
  }

  return result;
}

export function formatRetry(result: RetryResult): string {
  return (
    `[retry] ${result.attempted} eligible: ${result.relaunched} relaunched, ${result.failed} failed`
  );
}
