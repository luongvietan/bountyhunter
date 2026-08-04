import type { ContractTarget } from '@kritt-radar/collectors';
import { normalizeChainAddress } from '@kritt-radar/core';
import type { PrismaClient } from '@kritt-radar/db';
import { latestBySourceUrl, type ObservationRow } from './materialize.js';

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

function parseEtherscanPayload(payload: unknown): { chain: string; address: string } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const chain = (payload as { chain?: unknown }).chain;
  const address = (payload as { address?: unknown }).address;
  if (typeof chain !== 'string' || typeof address !== 'string') return null;
  return { chain, address };
}

/**
 * Ghi nhận scope kind=contract đã được `etherscan-verified` quan sát bằng cách
 * đảm bảo hardKey đã chuẩn hoá. KHÔNG tạo Signal — verified/unverified chỉ là
 * bằng chứng thu thập, chưa có extractor nào tiêu thụ nó ở phase này.
 */
export async function materializeEtherscanVerified(
  prisma: PrismaClient,
): Promise<{ observations: number; matched: number }> {
  const rows: ObservationRow[] = await prisma.observation.findMany({
    where: { collectorId: 'etherscan-verified' },
    select: { sourceUrl: true, fetchedAt: true, payload: true },
  });
  const latest = latestBySourceUrl(rows);

  let matched = 0;
  for (const row of latest) {
    const parsed = parseEtherscanPayload(row.payload);
    if (!parsed) continue;
    const hardKey = normalizeChainAddress(parsed.chain, parsed.address);
    if (!hardKey) continue;
    const separator = hardKey.indexOf(':');
    const chain = hardKey.slice(0, separator);
    const address = hardKey.slice(separator + 1);

    const scope = await prisma.scope.findFirst({
      where: { OR: [{ hardKey }, { chain, address }] },
      select: { id: true, hardKey: true },
    });
    if (!scope) continue;
    matched += 1;
    if (scope.hardKey !== hardKey) {
      await prisma.scope.update({ where: { id: scope.id }, data: { hardKey } });
    }
  }
  return { observations: latest.length, matched };
}
