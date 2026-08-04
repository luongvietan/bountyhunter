import type { Prisma, PrismaClient } from '@kritt-radar/db';
import { KrittClient, parseFindings, type ParsedFinding } from '@kritt-radar/pipeline';

/** Kritt statuses that mean the scan will produce nothing further. */
const TERMINAL_STATUSES = new Set(['completed', 'complete', 'finished', 'done', 'failed', 'error', 'cancelled', 'canceled']);
const FAILED_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled']);

export interface IngestResult {
  polled: number;
  finished: number;
  stillRunning: number;
  findingsStored: number;
  errors: number;
}

function decimal(value: number | null): Prisma.Decimal | null {
  return value === null ? null : (value as unknown as Prisma.Decimal);
}

async function storeFindings(
  prisma: PrismaClient,
  dispatchId: string,
  findings: readonly ParsedFinding[],
): Promise<number> {
  let stored = 0;

  for (const finding of findings) {
    const data = {
      rank: finding.rank,
      title: finding.title,
      vulnerabilityType: finding.vulnerabilityType,
      filePath: finding.filePath,
      line: finding.line,
      severity: finding.severity,
      exploitable: finding.exploitable,
      explanation: finding.explanation,
      maliciousInput: finding.maliciousInput,
      maliciousActor: finding.maliciousActor,
      triggerFlow: finding.triggerFlow,
      bountyRank: finding.bountyRank,
      impactLevel: finding.impactLevel,
      minRewardUsd: decimal(finding.minRewardUsd),
      maxRewardUsd: decimal(finding.maxRewardUsd),
      rankReasoning: finding.rankReasoning,
      clusterId: finding.clusterId,
      raw: finding.raw as Prisma.InputJsonValue,
    };

    await prisma.finding.upsert({
      where: { dispatchId_krittVulnId: { dispatchId, krittVulnId: finding.krittVulnId } },
      create: { dispatchId, krittVulnId: finding.krittVulnId, ...data },
      // Never touch `status` on update: a finding the operator already
      // dismissed or submitted must not return to the queue because a later
      // poll re-read the same scan.
      update: data,
    });
    stored += 1;
  }

  return stored;
}

/**
 * Poll dispatched scans and pull their findings in.
 *
 * Findings land with status `new` and stay there. Nothing in this file sends
 * anything to a bounty platform; the queue exists so a person decides what is
 * worth submitting.
 */
export async function ingestFindings(
  prisma: PrismaClient,
  client: KrittClient,
): Promise<IngestResult> {
  const running = await prisma.scanDispatch.findMany({
    where: { status: 'running', krittScanId: { not: null } },
    orderBy: { createdAt: 'asc' },
  });

  const result: IngestResult = {
    polled: running.length,
    finished: 0,
    stillRunning: 0,
    findingsStored: 0,
    errors: 0,
  };

  for (const dispatch of running) {
    const scanId = dispatch.krittScanId!;
    try {
      const { status } = await client.scanStatus(scanId);
      const normalized = status.trim().toLowerCase();

      if (!TERMINAL_STATUSES.has(normalized)) {
        result.stillRunning += 1;
        continue;
      }

      if (FAILED_STATUSES.has(normalized)) {
        await prisma.scanDispatch.update({
          where: { id: dispatch.id },
          data: { status: 'error', error: `Kritt scan ${normalized}`, finishedAt: new Date() },
        });
        result.errors += 1;
        continue;
      }

      const findings = parseFindings(await client.scanVulnerabilities(scanId));
      result.findingsStored += await storeFindings(prisma, dispatch.id, findings);
      await prisma.scanDispatch.update({
        where: { id: dispatch.id },
        data: { status: 'complete', finishedAt: new Date() },
      });
      result.finished += 1;
    } catch (error) {
      // A network blip must not mark a scan failed: it stays `running` and the
      // next poll tries again.
      result.errors += 1;
      await prisma.scanDispatch.update({
        where: { id: dispatch.id },
        data: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  return result;
}

export function formatIngest(result: IngestResult): string {
  return (
    `[ingest] polled ${result.polled} running scans: ` +
    `${result.finished} finished, ${result.stillRunning} still running, ${result.errors} errored\n` +
    `[ingest] ${result.findingsStored} findings stored, awaiting review`
  );
}
