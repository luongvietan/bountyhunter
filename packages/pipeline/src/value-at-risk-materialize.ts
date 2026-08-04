import type { Prisma, PrismaClient } from '@kritt-radar/db';
import {
  extractValueAtRiskBatch,
  type ValueAtRiskInput,
} from './extractors/value-at-risk.js';

export function buildValueAtRiskInputs(
  scopes: readonly { scopeId: string; poolUsd: number | null; defillamaSlug: string | null }[],
  tvlBySlug: ReadonlyMap<string, number>,
): ValueAtRiskInput[] {
  return scopes.map((scope) => ({
    scopeId: scope.scopeId,
    poolUsd: scope.poolUsd,
    tvlUsd: scope.defillamaSlug ? (tvlBySlug.get(scope.defillamaSlug) ?? null) : null,
    defillamaSlug: scope.defillamaSlug,
  }));
}

export async function loadValueAtRiskInputs(prisma: PrismaClient): Promise<ValueAtRiskInput[]> {
  const [scopes, protocolTvls] = await Promise.all([
    prisma.scope.findMany({
      select: {
        id: true,
        program: {
          select: {
            poolUsd: true,
            entity: {
              select: {
                aliases: {
                  where: { kind: 'defillama' },
                  orderBy: { key: 'asc' },
                  take: 1,
                  select: { key: true },
                },
              },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
    }),
    prisma.protocolTvl.findMany({
      select: { slug: true, tvlUsd: true },
    }),
  ]);

  const tvlBySlug = new Map(protocolTvls.map((row) => [row.slug, Number(row.tvlUsd)]));
  return buildValueAtRiskInputs(
    scopes.map((scope) => ({
      scopeId: scope.id,
      poolUsd: scope.program.poolUsd === null ? null : Number(scope.program.poolUsd),
      defillamaSlug: scope.program.entity?.aliases[0]?.key ?? null,
    })),
    tvlBySlug,
  );
}

export async function materializeValueAtRisk(prisma: PrismaClient): Promise<number> {
  const inputs = await loadValueAtRiskInputs(prisma);
  const signals = extractValueAtRiskBatch(inputs);
  const computedAt = new Date();

  for (const input of inputs) {
    const signal = signals.get(input.scopeId)!;
    await prisma.signal.upsert({
      where: { scopeId_type: { scopeId: input.scopeId, type: 'value_at_risk' } },
      create: {
        scopeId: input.scopeId,
        type: 'value_at_risk',
        value: signal.value,
        confidence: signal.confidence,
        evidence: signal.evidence as Prisma.InputJsonValue,
        observationIds: [],
        computedAt,
      },
      update: {
        value: signal.value,
        confidence: signal.confidence,
        evidence: signal.evidence as Prisma.InputJsonValue,
        observationIds: [],
        computedAt,
      },
    });
  }

  return inputs.length;
}
