import { KrittClient, DEFAULT_KRITT_API_URL } from '@kritt-radar/pipeline';
import { lastOpsEventsByKind, prisma } from '@kritt-radar/db';

const baseUrl = process.env.KRITT_API_URL ?? DEFAULT_KRITT_API_URL;
const client = new KrittClient({ baseUrl });

const krittUp = await client.health();
const accounts = krittUp ? await client.accounts().catch(() => []) : [];
const scans = krittUp ? await client.listScans().catch(() => []) : [];

const scanStatus = new Map<string, string>();
for (const scan of scans) {
  if (typeof scan !== 'object' || scan === null) continue;
  const row = scan as Record<string, unknown>;
  const id = row.id ?? row.scanId;
  const status = row.status;
  if (id !== undefined && typeof status === 'string') scanStatus.set(String(id), status);
}

const [dispatches, lastEvents, pendingMerges, newFindings, byStatus, recent] = await Promise.all([
  prisma.scanDispatch.findMany({
    where: { status: { in: ['running', 'requested', 'error'] } },
    orderBy: { updatedAt: 'desc' },
    take: 25,
  }),
  lastOpsEventsByKind(prisma),
  prisma.mergeCandidate.count({ where: { status: 'pending' } }),
  prisma.finding.count({ where: { status: 'new' } }),
  prisma.finding.groupBy({ by: ['status'], _count: true }),
  prisma.scanDispatch.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 12,
    select: { repoKey: true, status: true, krittScanId: true, updatedAt: true, commitSha: true },
  }),
]);

console.log('=== Open-Kritt ===');
console.log('up:', krittUp);
console.log('scans on server:', scans.length);
const runningOnKritt = [...scanStatus.entries()].filter(([, s]) => s === 'running' || s === 'queued');
console.log('running/queued on Kritt:', runningOnKritt.length);
for (const [id, status] of [...scanStatus.entries()].slice(0, 10)) {
  console.log(`  scan ${id}: ${status}`);
}
console.log('\n=== Providers ===');
const accountList = Array.isArray(accounts) ? accounts : [];
for (const entry of accountList) {
  if (typeof entry !== 'object' || entry === null) continue;
  const a = entry as Record<string, unknown>;
  console.log(`  ${a.name ?? a.id}: ${a.provider ?? '?'} — ${a.statusKind ?? a.status ?? '?'}`);
}

console.log('\n=== Automation ===');
console.log('pending merges:', pendingMerges);
console.log('new findings:', newFindings);
if (lastEvents.automate) {
  console.log('last automate:', lastEvents.automate.status, lastEvents.automate.createdAt.toISOString());
}

console.log('\n=== Ops events ===');
for (const [kind, ev] of Object.entries(lastEvents)) {
  if (ev) console.log(`  ${kind}: ${ev.status} @ ${ev.createdAt.toISOString()}`);
}

console.log('\n=== Active dispatches (Radar DB) ===');
if (dispatches.length === 0) console.log('  (none)');
for (const d of dispatches) {
  const ks = d.krittScanId ? (scanStatus.get(d.krittScanId) ?? '?') : '-';
  console.log(
    `  ${d.repoKey} @ ${d.commitSha.slice(0, 10)} | radar=${d.status} kritt=${ks} scan=${d.krittScanId ?? '-'}`,
  );
}

console.log('\n=== Recent dispatches ===');
for (const d of recent) {
  const ks = d.krittScanId ? (scanStatus.get(d.krittScanId) ?? '?') : '-';
  console.log(
    `  ${d.status.padEnd(10)} kritt=${String(ks).padEnd(10)} ${d.repoKey} @ ${d.commitSha.slice(0, 10)}`,
  );
}

console.log('\n=== Findings ===');
if (byStatus.length === 0) console.log('  (none stored yet)');
for (const row of byStatus) console.log(`  ${row.status}: ${row._count}`);

const latest = await prisma.finding.findMany({
  take: 8,
  orderBy: { fetchedAt: 'desc' },
  select: {
    title: true,
    severity: true,
    status: true,
    decidedBy: true,
    dispatch: { select: { repoKey: true } },
  },
});
if (latest.length > 0) {
  console.log('\n=== Latest findings ===');
  for (const f of latest) {
    const repo = f.dispatch?.repoKey ?? '?';
    console.log(
      `  [${f.severity ?? '?'}] ${f.title.slice(0, 70)} (${repo}) status=${f.status} by=${f.decidedBy ?? '-'}`,
    );
  }
}

await prisma.$disconnect();
