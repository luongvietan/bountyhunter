import { normalizeRepoUrl } from '@kritt-radar/core';
import type { Prisma, PrismaClient } from '@kritt-radar/db';
import {
  auditEntitySeed,
  extractFreshness,
  latestBySourceUrl,
  parseAliases,
  repoEntitySeed,
  scoreCandidate,
  toAuditReportRecords,
  toImmunefiRecords,
  toProgramRecords,
  type ProgramFields,
} from '@kritt-radar/pipeline';

const CONTEST_COLLECTORS = ['c4-contests', 'sherlock-contests', 'cantina-competitions'];
const CANDIDATE_THRESHOLD = 0.65;

type Transaction = Prisma.TransactionClient;
type ScopeInput = {
  hardKey: string;
  repoUrl: string;
  pathGlobs: string[];
  addedAt: Date | null;
};
type ProgramInput = { program: ProgramFields; scopes: ScopeInput[] };

export interface FoundationResult {
  programs: number;
  scopes: number;
  entities: number;
  reports: number;
  candidates: number;
}

function platformNameKey(platform: string, title: string): string {
  return `${platform.trim().toLowerCase()} ${title.trim()}`;
}

async function syncConfigAliases(
  tx: Transaction,
  aliases: ReturnType<typeof parseAliases>,
): Promise<void> {
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
  ];

  for (const { kind, key, target } of entries) {
    const entity = await tx.entity.upsert({
      where: { slug: target.slug },
      create: target,
      update: { canonicalName: target.canonicalName },
    });
    const existing = await tx.entityAlias.findUnique({ where: { kind_key: { kind, key } } });
    if (existing?.source === 'manual') continue;

    await tx.entityAlias.upsert({
      where: { kind_key: { kind, key } },
      create: { entityId: entity.id, kind, key, source: 'config' },
      update: { entityId: entity.id, source: 'config' },
    });
  }
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
): Promise<void> {
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
      kind: 'repo',
      hardKey: scopeInput.hardKey,
      repoUrl: scopeInput.repoUrl,
      pathGlobs: scopeInput.pathGlobs,
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
}

async function materializeCatalog(
  prisma: PrismaClient,
  aliases: ReturnType<typeof parseAliases>,
  programs: readonly ProgramInput[],
  now: Date,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await syncConfigAliases(tx, aliases);
    for (const program of programs) await upsertProgram(tx, program, now);
  });
}

async function materializeAudits(prisma: PrismaClient, now: Date): Promise<void> {
  const rows = await prisma.observation.findMany({
    where: { collectorId: 'audit-report-repos' },
    select: { id: true, sourceUrl: true, fetchedAt: true, payload: true },
  });
  const records = toAuditReportRecords(rows);

  await prisma.$transaction(async (tx) => {
    const programEntities = await tx.entity.findMany({
      where: { programs: { some: {} } },
      select: { id: true, canonicalName: true },
    });

    for (const record of records) {
      const auditHintKey = record.report.projectHint.trim().toLowerCase();
      const exactAlias = await tx.entityAlias.findUnique({
        where: { kind_key: { kind: 'audit_hint', key: auditHintKey } },
      });

      let entityId: string;
      if (exactAlias) {
        entityId = exactAlias.entityId;
      } else {
        const seed = auditEntitySeed(record.report.projectHint);
        const provisional = await tx.entity.upsert({
          where: { slug: seed.slug },
          create: seed,
          update: { canonicalName: seed.canonicalName },
        });
        entityId = provisional.id;

        for (const programEntity of programEntities) {
          if (programEntity.id === provisional.id) continue;
          const candidate = scoreCandidate(record.report.projectHint, programEntity.canonicalName);
          if (candidate.similarity < CANDIDATE_THRESHOLD) continue;
          await tx.mergeCandidate.upsert({
            where: {
              leftEntityId_rightEntityId: {
                leftEntityId: provisional.id,
                rightEntityId: programEntity.id,
              },
            },
            create: {
              leftEntityId: provisional.id,
              rightEntityId: programEntity.id,
              similarity: candidate.similarity,
              reason: candidate.reason,
              createdAt: now,
            },
            update: {
              similarity: candidate.similarity,
              reason: candidate.reason,
            },
          });
        }
      }

      await tx.auditReport.upsert({
        where: { reportUrl: record.report.reportUrl },
        create: { ...record.report, entityId },
        update: { ...record.report, entityId },
      });
    }
  });
}

export async function materializeCatalogFoundation(
  prisma: PrismaClient,
  aliasesYaml: string,
  now: Date,
): Promise<FoundationResult> {
  const aliases = parseAliases(aliasesYaml);
  const contestRows = await prisma.observation.findMany({
    where: { collectorId: { in: CONTEST_COLLECTORS } },
    select: { sourceUrl: true, fetchedAt: true, payload: true },
  });
  const contestPrograms = toProgramRecords(latestBySourceUrl(contestRows)).map(
    (record): ProgramInput => ({
      program: record.program,
      scopes: [{ ...record.scope, addedAt: record.changedAt }],
    }),
  );
  const immunefiRows = await prisma.observation.findMany({
    where: { collectorId: 'immunefi-programs' },
    select: { sourceUrl: true, fetchedAt: true, payload: true },
  });
  const immunefiPrograms = toImmunefiRecords(latestBySourceUrl(immunefiRows)).map(
    (record): ProgramInput => ({
      program: record.program,
      scopes: record.scopes,
    }),
  );

  await materializeCatalog(prisma, aliases, [...contestPrograms, ...immunefiPrograms], now);
  await materializeAudits(prisma, now);

  const [programs, scopes, entities, reports, candidates] = await Promise.all([
    prisma.program.count(),
    prisma.scope.count(),
    prisma.entity.count(),
    prisma.auditReport.count(),
    prisma.mergeCandidate.count(),
  ]);
  return { programs, scopes, entities, reports, candidates };
}
