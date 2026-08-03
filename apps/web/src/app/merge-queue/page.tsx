import { prisma } from '@kritt-radar/db';
import { CandidateCard } from './candidate-card';
import {
  listMergeQueue,
  parseQueueStatus,
  type MergeQueuePage,
  type QueueStatus,
} from '../../lib/merge-queue';

export const dynamic = 'force-dynamic';

interface MergeQueueRouteProps {
  searchParams: Promise<{ status?: string | string[] }>;
}

const tabLabels: Record<QueueStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

const setupErrorCodes = new Set(['P1000', 'P1001', 'P1002', 'P1003', 'P1012', 'P1013']);

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = (error as { code?: unknown; errorCode?: unknown }).code
    ?? (error as { errorCode?: unknown }).errorCode;
  return typeof value === 'string' ? value : undefined;
}

function isDatabaseSetupError(error: unknown): boolean {
  if (!process.env.DATABASE_URL) return true;
  const code = errorCode(error);
  return code !== undefined && setupErrorCodes.has(code);
}

function formatSyncTime(value: string): string {
  return `${new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value))} UTC`;
}

function SetupState() {
  return (
    <main className="page-shell setup-shell" id="main-content">
      <header className="masthead">
        <div>
          <p className="product-name">Kritt Radar</p>
          <p className="console-label">Internal operator console</p>
        </div>
      </header>
      <section className="setup-panel" aria-labelledby="setup-title">
        <span className="setup-index" aria-hidden="true">DB</span>
        <div>
          <h1 id="setup-title">Connect the evidence database</h1>
          <p>The merge queue is unavailable until PostgreSQL is running and the local data is prepared.</p>
          <ol>
            <li><code>docker compose up -d postgres</code></li>
            <li><code>pnpm migrate</code></li>
            <li><code>pnpm sync</code></li>
          </ol>
          <p className="setup-note">The connection value stays on the server and is never rendered here.</p>
        </div>
      </section>
    </main>
  );
}

function EmptyQueue({ page }: { page: MergeQueuePage }) {
  const total = page.counts.pending + page.counts.approved + page.counts.rejected;
  const firstRun = total === 0;
  return (
    <section className="empty-state" aria-labelledby="empty-title">
      <span aria-hidden="true">{firstRun ? '∅' : '✓'}</span>
      <div>
        <h2 id="empty-title">
          {firstRun ? 'No candidates yet' : `${tabLabels[page.status]} queue is empty`}
        </h2>
        <p>
          {firstRun
            ? 'Run the sync pipeline to collect evidence and materialize fuzzy entity candidates.'
            : page.status === 'pending'
              ? 'There are no unresolved entity matches. Approved and rejected decisions remain in history.'
              : `No ${page.status} decisions are recorded. Choose another status to continue reviewing.`}
        </p>
      </div>
    </section>
  );
}

function QueueScreen({ page, syncedAt }: { page: MergeQueuePage; syncedAt: string | null }) {
  return (
    <main className="page-shell" id="main-content">
      <header className="masthead">
        <div>
          <p className="product-name">Kritt Radar</p>
          <p className="console-label">Internal operator console</p>
        </div>
        <dl className="status-summary" aria-label="Merge candidate totals">
          {(Object.keys(tabLabels) as QueueStatus[]).map((status) => (
            <div key={status}>
              <dt>{tabLabels[status]}</dt>
              <dd>{page.counts[status]}</dd>
            </div>
          ))}
        </dl>
      </header>

      <section className="route-heading" aria-labelledby="page-title">
        <div>
          <h1 id="page-title">Merge review queue</h1>
          <p>Inspect identity evidence before changing durable aliases or report ownership.</p>
        </div>
        <p className="sync-time">
          <span>Last evidence sync</span>
          {syncedAt ? <time dateTime={syncedAt}>{formatSyncTime(syncedAt)}</time> : <strong>No completed sync</strong>}
        </p>
      </section>

      <nav className="status-tabs" aria-label="Merge queue status">
        {(Object.keys(tabLabels) as QueueStatus[]).map((status) => (
          <a
            aria-current={page.status === status ? 'page' : undefined}
            className={page.status === status ? 'status-tab status-tab-active' : 'status-tab'}
            href={`/merge-queue?status=${status}`}
            key={status}
          >
            {tabLabels[status]} <span>{page.counts[status]}</span>
          </a>
        ))}
      </nav>

      <section className="queue-region" aria-label={`${tabLabels[page.status]} merge candidates`}>
        {page.candidates.length === 0 ? (
          <EmptyQueue page={page} />
        ) : (
          <div className="candidate-list">
            {page.candidates.map((candidate) => (
              <CandidateCard candidate={candidate} key={candidate.id} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export default async function MergeQueueRoute({ searchParams }: MergeQueueRouteProps) {
  const params = await searchParams;
  const status = parseQueueStatus(params.status);

  if (!process.env.DATABASE_URL) return <SetupState />;

  try {
    const [page, latestRun] = await Promise.all([
      listMergeQueue(prisma, status),
      prisma.collectorRun.findFirst({
        where: { status: 'ok' },
        orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }],
        select: { finishedAt: true, startedAt: true },
      }),
    ]);
    const syncDate = latestRun?.finishedAt ?? latestRun?.startedAt ?? null;
    return <QueueScreen page={page} syncedAt={syncDate?.toISOString() ?? null} />;
  } catch (error) {
    if (isDatabaseSetupError(error)) return <SetupState />;
    throw error;
  }
}
