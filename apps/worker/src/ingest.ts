import type { Prisma, PrismaClient } from '@kritt-radar/db';
import {
  KrittClient,
  parseFindings,
  classifyKrittScanStatus,
  autoTriageEnabled,
  triageDismissVerdict,
  type ParsedFinding,
} from '@kritt-radar/pipeline';

export interface IngestResult {
  polled: number;
  finished: number;
  stillRunning: number;
  findingsStored: number;
  autoDismissed: number;
  errors: number;
}

function decimal(value: number | null): Prisma.Decimal | null {
  return value === null ? null : (value as unknown as Prisma.Decimal);
}

async function storeFindings(
  prisma: PrismaClient,
  dispatchId: string,
  findings: readonly ParsedFinding[],
): Promise<{ stored: number; autoDismissed: number }> {
  let stored = 0;
  let autoDismissed = 0;
  const applyTriage = autoTriageEnabled();
  const dryRun = process.env.RADAR_AUTOMATE_DRY_RUN === 'true';

  for (const finding of findings) {
    const triage = applyTriage ? triageDismissVerdict(finding) : { dismiss: false, decidedBy: null, reason: null };
    const now = new Date();

    const existing = await prisma.finding.findUnique({
      where: { dispatchId_krittVulnId: { dispatchId, krittVulnId: finding.krittVulnId } },
      select: { status: true },
    });

    const baseData = {
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
      krittReport: finding.krittReport,
      pocDiff: finding.pocDiff,
      inScope: finding.inScope,
      postScriptValid: finding.postScriptValid,
      raw: finding.raw as Prisma.InputJsonValue,
    };

    const canAutoDismiss = applyTriage && triage.dismiss && (!existing || existing.status === 'new');

    if (dryRun && canAutoDismiss) {
      console.log(
        `[ingest] dry-run would dismiss ${finding.krittVulnId} (${triage.decidedBy}): ${triage.reason}`,
      );
      autoDismissed += 1;
      stored += 1;
      continue;
    }

    await prisma.finding.upsert({
      where: { dispatchId_krittVulnId: { dispatchId, krittVulnId: finding.krittVulnId } },
      create: {
        dispatchId,
        krittVulnId: finding.krittVulnId,
        ...baseData,
        status: canAutoDismiss ? 'dismissed' : 'new',
        decidedAt: canAutoDismiss ? now : null,
        decidedBy: canAutoDismiss ? triage.decidedBy : null,
        triageReason: canAutoDismiss ? triage.reason : null,
      },
      update: {
        ...baseData,
        fetchedAt: new Date(),
        ...(canAutoDismiss
          ? {
              status: 'dismissed',
              decidedAt: now,
              decidedBy: triage.decidedBy,
              triageReason: triage.reason,
            }
          : {}),
      },
    });

    if (canAutoDismiss) autoDismissed += 1;
    stored += 1;
  }

  return { stored, autoDismissed };
}

/**
 * Poll dispatched scans and pull their findings in.
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
    autoDismissed: 0,
    errors: 0,
  };

  for (const dispatch of running) {
    const scanId = dispatch.krittScanId!;
    try {
      const { status } = await client.scanStatus(scanId);
      const phase = classifyKrittScanStatus(status);

      if (phase === 'running') {
        result.stillRunning += 1;
        continue;
      }

      if (phase === 'failed') {
        await prisma.scanDispatch.update({
          where: { id: dispatch.id },
          data: {
            status: 'error',
            error: `Kritt scan ${status.trim().toLowerCase()}`,
            finishedAt: new Date(),
          },
        });
        result.errors += 1;
        continue;
      }

      const findings = parseFindings(await client.scanVulnerabilities(scanId));
      const stored = await storeFindings(prisma, dispatch.id, findings);
      result.findingsStored += stored.stored;
      result.autoDismissed += stored.autoDismissed;
      await prisma.scanDispatch.update({
        where: { id: dispatch.id },
        data: { status: 'complete', finishedAt: new Date() },
      });
      result.finished += 1;
    } catch (error) {
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
  const triageLine =
    result.autoDismissed > 0
      ? `, ${result.autoDismissed} auto-dismissed`
      : '';
  return (
    `[ingest] polled ${result.polled} running scans: ` +
    `${result.finished} finished, ${result.stillRunning} still running, ${result.errors} errored\n` +
    `[ingest] ${result.findingsStored} findings stored${triageLine}, awaiting review`
  );
}
