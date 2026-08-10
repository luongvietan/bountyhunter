import { KrittClient, DEFAULT_KRITT_API_URL } from '@kritt-radar/pipeline';
import { lastOpsEventsByKind, prisma } from '@kritt-radar/db';

export interface ProviderQuotaRow {
  name: string;
  provider: string;
  status: string;
  detail: string;
}

export interface HealthDispatchRow {
  id: string;
  repoKey: string;
  commitSha: string;
  status: string;
  krittScanId: string | null;
  krittStatus: string | null;
  retryCount: number;
  providerUsed: string | null;
  scopeFileCount: number | null;
  updatedAt: Date;
}

export interface AutomationSummary {
  pendingMerges: number;
  newFindings: number;
  lastAutomate: { createdAt: Date; status: string; message: string | null } | null;
}

export interface HealthSnapshot {
  krittUp: boolean;
  providers: ProviderQuotaRow[];
  dispatches: HealthDispatchRow[];
  automation: AutomationSummary;
  lastEvents: Partial<
    Record<
      'sync' | 'ingest' | 'dispatch' | 'watch' | 'automate',
      { createdAt: Date; status: string; message: string | null }
    >
  >;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function parseProviders(raw: unknown): ProviderQuotaRow[] {
  const rows: ProviderQuotaRow[] = [];
  const list = Array.isArray(raw) ? raw : [];
  for (const entry of list) {
    const account = asRecord(entry);
    if (!account) continue;
    const name = String(account.name ?? account.label ?? account.id ?? 'account');
    const provider = String(account.provider ?? account.kind ?? 'unknown');
    const statusKind = account.statusKind ?? account.status;
    const status = typeof statusKind === 'string' ? statusKind : 'unknown';

    let detail = '';
    const rateLimits = asRecord(account.rateLimits);
    const primary = rateLimits ? asRecord(rateLimits.primary) : null;
    if (primary && typeof primary.usedPercent === 'number') {
      detail = `${primary.usedPercent}% used`;
      if (typeof primary.resetsAt === 'string') detail += ` · resets ${primary.resetsAt}`;
    } else if (typeof account.credit === 'number' || typeof account.credit === 'string') {
      detail = `credit ${account.credit}`;
    }

    rows.push({ name, provider, status, detail: detail || '—' });
  }
  return rows;
}

export async function loadHealthSnapshot(): Promise<HealthSnapshot> {
  const baseUrl = process.env.KRITT_API_URL ?? DEFAULT_KRITT_API_URL;
  const client = new KrittClient({ baseUrl });

  const [krittUp, accountsRaw, dispatches, lastEvents, pendingMerges, newFindings] =
    await Promise.all([
      client.health(),
      client.health().then((up) => (up ? client.accounts().catch(() => []) : [])),
      prisma.scanDispatch.findMany({
        where: { status: { in: ['running', 'requested', 'error'] } },
        orderBy: { updatedAt: 'desc' },
        take: 25,
        select: {
          id: true,
          repoKey: true,
          commitSha: true,
          status: true,
          krittScanId: true,
          retryCount: true,
          providerUsed: true,
          scopeFileCount: true,
          updatedAt: true,
        },
      }),
      lastOpsEventsByKind(prisma),
      prisma.mergeCandidate.count({ where: { status: 'pending' } }),
      prisma.finding.count({ where: { status: 'new' } }),
    ]);

  const krittStatuses = new Map<string, string>();
  if (krittUp) {
    const scans = await client.listScans().catch(() => []);
    for (const scan of scans) {
      const row = asRecord(scan);
      if (!row) continue;
      const id = row.id ?? row.scanId;
      const status = row.status;
      if (id !== undefined && typeof status === 'string') {
        krittStatuses.set(String(id), status);
      }
    }
  }

  return {
    krittUp,
    providers: parseProviders(accountsRaw),
    dispatches: dispatches.map((row) => ({
      ...row,
      krittStatus: row.krittScanId ? (krittStatuses.get(row.krittScanId) ?? null) : null,
    })),
    automation: {
      pendingMerges,
      newFindings,
      lastAutomate: lastEvents.automate ?? null,
    },
    lastEvents,
  };
}
