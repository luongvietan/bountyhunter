import { randomUUID } from 'node:crypto';
import { normalizeRepoUrl } from '@kritt-radar/core';
import type { Prisma, PrismaClient } from '@kritt-radar/db';
import {
  auditEntitySeed,
  extractFreshness,
  latestBySourceUrl,
  normalizeIdentityText,
  parseAliases,
  repoEntitySeed,
  scoreCandidate,
  toAuditReportRecords,
  toImmunefiRecords,
  toProgramRecords,
  toSherlockRecords,
  parseManualPrograms,
  mergeManualImmunefiPrograms,
  type ProgramAuditRecord,
  type ProgramFields,
} from '@kritt-radar/pipeline';

const CONTEST_COLLECTORS = ['c4-contests', 'cantina-competitions'];
const CANDIDATE_THRESHOLD = 0.65;

type Transaction = Prisma.TransactionClient;
type ScopeInput = {
  kind?: 'repo' | 'contract';
  hardKey: string;
  repoUrl: string | null;
  pathGlobs: string[];
  chain?: string;
  address?: string;
  addedAt: Date | null;
};
type ProgramInput = {
  program: ProgramFields;
  scopes: ScopeInput[];
  audits?: ProgramAuditRecord[];
};
type CandidateScoreReason = { tokenJaccard: number; editSimilarity: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExactIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function isValidApprovalEvidence(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (
    typeof value.reportsMoved !== 'number'
    || !Number.isSafeInteger(value.reportsMoved)
    || value.reportsMoved < 1
    || !Array.isArray(value.aliasKeys)
    || value.aliasKeys.length < 1
  ) return false;

  const aliasKeys = value.aliasKeys;
  for (let index = 0; index < aliasKeys.length; index += 1) {
    const key = aliasKeys[index];
    if (typeof key !== 'string' || key.length === 0 || key !== key.trim().toLowerCase()) {
      return false;
    }
    if (index > 0 && aliasKeys[index - 1]! >= key) return false;
  }

  if (!isRecord(value.newestReport)) return false;
  return (
    typeof value.newestReport.firm === 'string'
    && value.newestReport.firm.length > 0
    && typeof value.newestReport.projectHint === 'string'
    && value.newestReport.projectHint.length > 0
    && typeof value.newestReport.reportUrl === 'string'
    && value.newestReport.reportUrl.length > 0
    && isExactIsoDate(value.newestReport.publishedAt)
  );
}

export function refreshCandidateReason(
  existingStatus: string | undefined,
  existingReason: unknown,
  freshScores: CandidateScoreReason,
): Record<string, unknown> {
  if (existingStatus !== 'approved' || !isRecord(existingReason)) return freshScores;
  const snapshot = existingReason.approvalEvidence;
  return isValidApprovalEvidence(snapshot)
    ? { ...freshScores, approvalEvidence: snapshot }
    : freshScores;
}

export interface FoundationResult {
  programs: number;
  scopes: number;
  entities: number;
  /** Report lấy từ repo của các hãng audit; phải đoán xem thuộc dự án nào. */
  reports: number;
  /** Audit do chính nền tảng khai trên program; nối chắc chắn, không phải đoán. */
  programAudits: number;
  candidates: number;
}

async function loadContestPrograms(
  prisma: PrismaClient,
): Promise<{ programs: ProgramInput[]; droppedNoRepo: number }> {
  const rows = await prisma.observation.findMany({
    where: { collectorId: { in: CONTEST_COLLECTORS } },
    select: { sourceUrl: true, fetchedAt: true, payload: true },
  });
  const latest = latestBySourceUrl(rows);
  const records = toProgramRecords(latest);
  return {
    droppedNoRepo: latest.length - records.length,
    programs: records.map(
      (record): ProgramInput => ({
        program: record.program,
        scopes: [{ ...record.scope, addedAt: record.changedAt }],
      }),
    ),
  };
}

export async function countDroppedContestPrograms(prisma: PrismaClient): Promise<number> {
  return (await loadContestPrograms(prisma)).droppedNoRepo;
}

async function loadSherlockPrograms(prisma: PrismaClient): Promise<ProgramInput[]> {
  const rows = await prisma.observation.findMany({
    where: { collectorId: 'sherlock-contests' },
    select: { sourceUrl: true, fetchedAt: true, payload: true },
  });
  return toSherlockRecords(latestBySourceUrl(rows)).map(
    (record): ProgramInput => ({
      program: record.program,
      scopes: record.scopes.map((scope) => ({ ...scope, addedAt: record.changedAt })),
      audits: record.audits,
    }),
  );
}

function platformNameKey(platform: string, title: string): string {
  return `${platform.trim().toLowerCase()} ${title.trim()}`;
}

async function syncConfigAliases(
  tx: Transaction,
  aliases: ReturnType<typeof parseAliases>,
): Promise<Set<string>> {
  const entries = [
    ...[...aliases.byRepoKey].map(([key, target]) => ({ kind: 'repo', key, target })),
    ...[...aliases.byPlatformName].map(([key, target]) => ({
      kind: 'platform_name',
      key,
      target,
    })),
    ...[...aliases.byAuditHint].map(([key, target]) => ({
      kind: 'audit_hint',
      key,
      target,
    })),
    ...[...aliases.byDefillama].map(([key, target]) => ({
      kind: 'defillama',
      key,
      target,
    })),
  ];
  const entityIds = new Set<string>();

  for (const { kind, key, target } of entries) {
    const entity = await tx.entity.upsert({
      where: { slug: target.slug },
      create: target,
      update: { canonicalName: target.canonicalName },
    });
    entityIds.add(entity.id);
    await tx.$executeRaw`
      INSERT INTO "EntityAlias" ("id", "entityId", "kind", "key", "source")
      VALUES (${randomUUID()}, ${entity.id}, ${kind}, ${key}, 'config')
      ON CONFLICT ("kind", "key") DO UPDATE
      SET "entityId" = EXCLUDED."entityId", "source" = 'config'
      WHERE "EntityAlias"."source" = 'config'
    `;
  }

  const desiredKeys = new Set(entries.map(({ kind, key }) => `${kind}\u0000${key}`));
  const configAliases = await tx.entityAlias.findMany({
    where: { source: 'config' },
    select: { id: true, kind: true, key: true },
  });
  const staleIds = configAliases
    .filter(({ kind, key }) => !desiredKeys.has(`${kind}\u0000${key}`))
    .map(({ id }) => id);
  if (staleIds.length > 0) {
    await tx.entityAlias.deleteMany({ where: { id: { in: staleIds }, source: 'config' } });
  }
  return entityIds;
}

async function resolveProgramEntity(
  tx: Transaction,
  program: ProgramFields,
  scopes: readonly ScopeInput[],
): Promise<string> {
  for (const scope of scopes) {
    const repoKey = normalizeRepoUrl(scope.hardKey);
    if (!repoKey) continue;
    const alias = await tx.entityAlias.findUnique({
      where: { kind_key: { kind: 'repo', key: repoKey } },
    });
    if (alias) return alias.entityId;
  }

  const platformAlias = await tx.entityAlias.findUnique({
    where: {
      kind_key: {
        kind: 'platform_name',
        key: platformNameKey(program.platform, program.title),
      },
    },
  });
  if (platformAlias) return platformAlias.entityId;

  const repoKey = normalizeRepoUrl(scopes[0]!.hardKey) ?? scopes[0]!.hardKey;
  const seed = repoEntitySeed(repoKey);
  const entity = await tx.entity.upsert({
    where: { slug: seed.slug },
    create: seed,
    update: { canonicalName: seed.canonicalName },
  });
  return entity.id;
}

async function upsertProgram(
  tx: Transaction,
  input: ProgramInput,
  now: Date,
): Promise<{ entityId: string; scopes: number; audits: number }> {
  const entityId = await resolveProgramEntity(tx, input.program, input.scopes);
  const saved = await tx.program.upsert({
    where: {
      platform_externalId: {
        platform: input.program.platform,
        externalId: input.program.externalId,
      },
    },
    create: { ...input.program, entityId },
    update: { ...input.program, entityId },
  });

  for (const scopeInput of input.scopes) {
    const existing = await tx.scope.findFirst({
      where: { programId: saved.id, hardKey: scopeInput.hardKey },
    });
    const scopeData = {
      kind: scopeInput.kind ?? 'repo',
      hardKey: scopeInput.hardKey,
      repoUrl: scopeInput.repoUrl,
      pathGlobs: scopeInput.pathGlobs,
      chain: scopeInput.chain ?? null,
      address: scopeInput.address ?? null,
    };
    const scope = existing
      ? await tx.scope.update({ where: { id: existing.id }, data: scopeData })
      : await tx.scope.create({ data: { ...scopeData, programId: saved.id } });

    const freshness = extractFreshness(
      {
        publishedAt: input.program.publishedAt ?? undefined,
        scopeChangedAt: scopeInput.addedAt ?? undefined,
      },
      now,
    );
    await tx.signal.upsert({
      where: { scopeId_type: { scopeId: scope.id, type: freshness.type } },
      create: {
        scopeId: scope.id,
        type: freshness.type,
        value: freshness.value,
        confidence: freshness.confidence,
        evidence: freshness.evidence as Prisma.InputJsonValue,
        observationIds: [],
        computedAt: now,
      },
      update: {
        value: freshness.value,
        confidence: freshness.confidence,
        evidence: freshness.evidence as Prisma.InputJsonValue,
        computedAt: now,
      },
    });
  }
  const audits = await upsertProgramAudits(tx, entityId, input);
  return { entityId, scopes: input.scopes.length, audits };
}

/**
 * Ghi audit mà nền tảng khai sẵn cho program, gắn vào chính entity của program.
 *
 * Khác hẳn `materializeAudits`: ở đó report đến từ repo của các hãng audit nên
 * phải đoán xem nó thuộc dự án nào (khớp tên, trúng dưới 1%). Ở đây nguồn đã nói
 * rõ audit này của program nào, nên liên kết là chắc chắn theo cấu trúc.
 */
async function upsertProgramAudits(
  tx: Transaction,
  entityId: string,
  input: ProgramInput,
): Promise<number> {
  const audits = input.audits ?? [];
  for (const audit of audits) {
    await tx.auditReport.upsert({
      where: { reportUrl: audit.reportUrl },
      create: {
        entityId,
        firm: audit.firm,
        publishedAt: audit.publishedAt,
        projectHint: audit.projectHint ?? input.program.externalId,
        reportUrl: audit.reportUrl,
        coveredCommit: audit.coveredCommit,
        coveredPaths: audit.coveredPaths,
        observationIds: [],
      },
      update: {
        entityId,
        firm: audit.firm,
        publishedAt: audit.publishedAt,
        projectHint: audit.projectHint ?? input.program.externalId,
        coveredCommit: audit.coveredCommit,
        coveredPaths: audit.coveredPaths,
      },
    });
  }
  return audits.length;
}

async function materializeCatalog(
  prisma: PrismaClient,
  aliases: ReturnType<typeof parseAliases>,
  programs: readonly ProgramInput[],
  now: Date,
): Promise<{ programs: number; scopes: number; programAudits: number; entityIds: Set<string> }> {
  // One transaction per program rather than one around the whole catalog.
  // A single transaction over every program ran for longer than Prisma's
  // interactive-transaction timeout once the catalog passed a few hundred
  // entries, and the run died with "Transaction not found" after the writes
  // had already started. Per-program is also the honest atomic unit: a
  // program with its scopes, signals and audits either lands or does not, and
  // every write is an upsert, so a partial run is completed by the next one.
  const entityIds = await prisma.$transaction((tx) => syncConfigAliases(tx, aliases));

  let scopes = 0;
  let programAudits = 0;
  for (const program of programs) {
    const saved = await prisma.$transaction((tx) => upsertProgram(tx, program, now));
    entityIds.add(saved.entityId);
    scopes += saved.scopes;
    programAudits += saved.audits;
  }

  return { programs: programs.length, scopes, programAudits, entityIds };
}

async function materializeAudits(
  prisma: PrismaClient,
  now: Date,
): Promise<{ reports: number; candidates: number; entityIds: Set<string> }> {
  const rows = await prisma.observation.findMany({
    where: { collectorId: 'audit-report-repos' },
    select: { id: true, sourceUrl: true, fetchedAt: true, payload: true },
  });
  const records = toAuditReportRecords(rows);

  const entityIds = new Set<string>();
  const candidateKeys = new Set<string>();
  // Read the candidate targets once, outside any transaction: it is a large
  // read that does not need to be inside the write that follows.
  const programEntities = await prisma.entity.findMany({
    where: { programs: { some: {} } },
    select: { id: true, canonicalName: true, slug: true },
  });

  // Per report, for the same reason as the catalog above: six hundred reports
  // in one interactive transaction outlives Prisma's timeout.
  for (const record of records) {
    await prisma.$transaction(async (tx) => {
      const auditHintKey = record.report.projectHint.trim().toLowerCase();
      const exactAlias = await tx.entityAlias.findUnique({
        where: { kind_key: { kind: 'audit_hint', key: auditHintKey } },
      });
      const normalizedHint = normalizeIdentityText(record.report.projectHint);
      const normalizedMatches = exactAlias || normalizedHint.length === 0
        ? []
        : programEntities.filter((entity) =>
            [entity.canonicalName, entity.slug]
              .map(normalizeIdentityText)
              .includes(normalizedHint),
          );
      const normalizedExact = normalizedMatches.length === 1 ? normalizedMatches[0] : undefined;
      const existingReport = await tx.auditReport.findUnique({
        where: { reportUrl: record.report.reportUrl },
        select: { entity: { select: { programs: { select: { id: true }, take: 1 } } } },
      });

      let entityId: string;
      if (exactAlias) {
        entityId = exactAlias.entityId;
        entityIds.add(entityId);
      } else if (normalizedExact) {
        entityId = normalizedExact.id;
        entityIds.add(entityId);
      } else {
        const seed = auditEntitySeed(record.report.projectHint);
        const provisional = await tx.entity.upsert({
          where: { slug: seed.slug },
          create: seed,
          update: { canonicalName: seed.canonicalName },
        });
        entityId = provisional.id;
        entityIds.add(entityId);

        for (const programEntity of programEntities) {
          if (programEntity.id === provisional.id) continue;
          const candidate = scoreCandidate(record.report.projectHint, programEntity.canonicalName);
          if (candidate.similarity < CANDIDATE_THRESHOLD) continue;
          candidateKeys.add(`${provisional.id}\u0000${programEntity.id}`);
          const candidateWhere = {
            leftEntityId_rightEntityId: {
              leftEntityId: provisional.id,
              rightEntityId: programEntity.id,
            },
          };
          const existingCandidate = await tx.mergeCandidate.findUnique({
            where: candidateWhere,
            select: { status: true, reason: true },
          });
          await tx.mergeCandidate.upsert({
            where: candidateWhere,
            create: {
              leftEntityId: provisional.id,
              rightEntityId: programEntity.id,
              similarity: candidate.similarity,
              reason: candidate.reason,
              createdAt: now,
            },
            update: {
              similarity: candidate.similarity,
              reason: refreshCandidateReason(
                existingCandidate?.status,
                existingCandidate?.reason,
                candidate.reason,
              ) as Prisma.InputJsonObject,
            },
          });
        }
      }

      const reportUpdate = {
        firm: record.report.firm,
        publishedAt: record.report.publishedAt,
        projectHint: record.report.projectHint,
        observationIds: record.report.observationIds,
      };
      const shouldUpdateEntity = Boolean(
        exactAlias ||
        (normalizedExact && (!existingReport || existingReport.entity.programs.length === 0)),
      );
      await tx.auditReport.upsert({
        where: { reportUrl: record.report.reportUrl },
        create: { ...record.report, entityId },
        update: { ...reportUpdate, ...(shouldUpdateEntity ? { entityId } : {}) },
      });
    });
  }

  return { reports: records.length, candidates: candidateKeys.size, entityIds };
}

export async function materializeCatalogFoundation(
  prisma: PrismaClient,
  aliasesYaml: string,
  now: Date,
  manualProgramsYaml = '',
): Promise<FoundationResult> {
  const aliases = parseAliases(aliasesYaml);
  const contest = await loadContestPrograms(prisma);
  const sherlockPrograms = await loadSherlockPrograms(prisma);
  const immunefiRows = await prisma.observation.findMany({
    where: { collectorId: 'immunefi-programs' },
    select: { sourceUrl: true, fetchedAt: true, payload: true },
  });
  const immunefiRecords = mergeManualImmunefiPrograms(
    toImmunefiRecords(latestBySourceUrl(immunefiRows)),
    manualProgramsYaml.trim() ? parseManualPrograms(manualProgramsYaml) : [],
  );
  const immunefiPrograms = immunefiRecords.map(
    (record): ProgramInput => ({
      program: record.program,
      scopes: record.scopes,
      audits: record.audits,
    }),
  );

  const catalog = await materializeCatalog(
    prisma,
    aliases,
    [...contest.programs, ...sherlockPrograms, ...immunefiPrograms],
    now,
  );
  const audits = await materializeAudits(prisma, now);
  const entityIds = new Set([...catalog.entityIds, ...audits.entityIds]);
  return {
    programs: catalog.programs,
    scopes: catalog.scopes,
    entities: entityIds.size,
    reports: audits.reports,
    programAudits: catalog.programAudits,
    candidates: audits.candidates,
  };
}

export { listRepoTargets, materializeRepoSignals } from '@kritt-radar/pipeline';
