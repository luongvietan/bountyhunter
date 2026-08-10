import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

export type OpsEventKind = 'sync' | 'ingest' | 'dispatch' | 'watch' | 'automate';

export interface LastOpsEventRow {
  createdAt: Date;
  status: string;
  message: string | null;
}

type OpsEventClient = {
  create: (args: {
    data: {
      kind: string;
      status: string;
      message: string | null;
      meta?: Prisma.InputJsonValue;
    };
  }) => Promise<unknown>;
  findFirst: (args: {
    where: { kind: string };
    orderBy: { createdAt: 'desc' };
    select: { createdAt: true; status: true; message: true };
  }) => Promise<LastOpsEventRow | null>;
};

function opsEventClient(prisma: PrismaClient): OpsEventClient | null {
  const delegate = (prisma as PrismaClient & { opsEvent?: OpsEventClient }).opsEvent;
  return delegate ?? null;
}

export async function recordOpsEvent(
  prisma: PrismaClient,
  kind: OpsEventKind,
  status: 'ok' | 'error',
  message?: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  const delegate = opsEventClient(prisma);
  if (delegate) {
    await delegate.create({
      data: {
        kind,
        status,
        message: message ?? null,
        ...(meta ? { meta: meta as Prisma.InputJsonValue } : {}),
      },
    });
    return;
  }

  await prisma.$executeRaw`
    INSERT INTO "OpsEvent" (id, kind, status, message, meta, "createdAt")
    VALUES (
      ${randomUUID()},
      ${kind},
      ${status},
      ${message ?? null},
      ${meta ? JSON.stringify(meta) : null}::jsonb,
      NOW()
    )
  `;
}

export async function lastOpsEventsByKind(
  prisma: PrismaClient,
): Promise<Partial<Record<OpsEventKind, LastOpsEventRow>>> {
  const delegate = opsEventClient(prisma);
  if (delegate) {
    const kinds: OpsEventKind[] = ['sync', 'ingest', 'dispatch', 'watch', 'automate'];
    const entries = await Promise.all(
      kinds.map(async (kind) => {
        const row = await delegate.findFirst({
          where: { kind },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, status: true, message: true },
        });
        return row ? ([kind, row] as const) : null;
      }),
    );
    return Object.fromEntries(
      entries.filter((entry): entry is [OpsEventKind, LastOpsEventRow] => entry !== null),
    );
  }

  try {
    const rows = await prisma.$queryRaw<
      Array<{ kind: string; createdAt: Date; status: string; message: string | null }>
    >`
      SELECT DISTINCT ON (kind) kind, "createdAt", status, message
      FROM "OpsEvent"
      ORDER BY kind, "createdAt" DESC
    `;
    const result: Partial<Record<OpsEventKind, LastOpsEventRow>> = {};
    for (const row of rows) {
      if (
        row.kind === 'sync' ||
        row.kind === 'ingest' ||
        row.kind === 'dispatch' ||
        row.kind === 'watch' ||
        row.kind === 'automate'
      ) {
        result[row.kind] = {
          createdAt: row.createdAt,
          status: row.status,
          message: row.message,
        };
      }
    }
    return result;
  } catch {
    return {};
  }
}
