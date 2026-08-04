import type { ContractTarget } from '@kritt-radar/collectors';
import { normalizeChainAddress } from '@kritt-radar/core';
import type { PrismaClient } from '@kritt-radar/db';

interface ContractTargetRow {
  chain: string | null;
  address: string | null;
}

export function buildContractTargets(rows: readonly ContractTargetRow[]): ContractTarget[] {
  const targets = new Map<string, ContractTarget>();

  for (const row of rows) {
    if (!row.chain || !row.address) continue;
    const hardKey = normalizeChainAddress(row.chain, row.address);
    if (!hardKey || targets.has(hardKey)) continue;

    const separator = hardKey.indexOf(':');
    targets.set(hardKey, {
      chain: hardKey.slice(0, separator),
      address: hardKey.slice(separator + 1),
    });
  }

  return [...targets.values()];
}

export async function listContractTargets(prisma: PrismaClient): Promise<ContractTarget[]> {
  const scopes = await prisma.scope.findMany({
    where: {
      AND: [{ chain: { not: null } }, { address: { not: null } }],
    },
    select: { chain: true, address: true },
    orderBy: { id: 'asc' },
  });

  return buildContractTargets(scopes);
}
