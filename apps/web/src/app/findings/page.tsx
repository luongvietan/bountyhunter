import Link from 'next/link';
import { prisma } from '@kritt-radar/db';
import { isDatabaseSetupError } from '../merge-queue/database-setup';
import {
  listFindingQueue,
  parseFindingStatus,
  type FindingQueuePage,
  type FindingStatus,
} from '../../lib/finding-queue';
import { FindingCard } from './finding-card';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Findings' };

interface FindingsRouteProps {
  searchParams: Promise<{ status?: string | string[] }>;
}

const tabs: Array<{ status: FindingStatus; label: string }> = [
  { status: 'new', label: 'New' },
  { status: 'submitted', label: 'Submitted' },
  { status: 'dismissed', label: 'Dismissed' },
];

function Empty({ status }: { status: FindingStatus }) {
  return (
    <div className="empty-state">
      <h2>Nothing here yet</h2>
      {status === 'new' ? (
        <p>
          Findings appear after a scan completes. Hand targets to Open-Kritt with{' '}
          <code>pnpm dispatch --apply</code>, then pull the results back with{' '}
          <code>pnpm ingest</code>.
        </p>
      ) : (
        <p>No findings have reached this state.</p>
      )}
      <Link className="button-secondary" href="/targets">
        Go to target ranking
      </Link>
    </div>
  );
}

function SetupState() {
  return (
    <main className="page-shell setup-shell" id="main-content">
      <section className="setup-panel">
        <h1>Connect the evidence database</h1>
        <p>The findings queue is unavailable until PostgreSQL is running.</p>
      </section>
    </main>
  );
}

export default async function FindingsRoute({ searchParams }: FindingsRouteProps) {
  const raw = await searchParams;
  const status = parseFindingStatus(raw.status);

  let page: FindingQueuePage;
  try {
    page = await listFindingQueue(prisma, status);
  } catch (error) {
    if (isDatabaseSetupError(error, process.env.DATABASE_URL)) return <SetupState />;
    throw error;
  }

  return (
    <main className="page-shell" id="main-content">
      <header className="masthead">
        <div>
          <p className="product-name">Kritt Radar</p>
          <p className="console-label">Internal operator console</p>
        </div>
        <nav className="masthead-nav" aria-label="Console sections">
          <Link href="/targets">Targets</Link>
          <Link aria-current="page" href="/findings">
            Findings
          </Link>
          <Link href="/merge-queue">Merge queue</Link>
          <Link href="/outcomes">Outcomes</Link>
        </nav>
      </header>

      <section className="route-heading">
        <div>
          <h1>Findings</h1>
          <p>
            What Open-Kritt reported, ranked by the reward it expects. Nothing here has been sent
            anywhere. Read the draft, verify the claim against the code, and submit through the
            program&apos;s own form.
          </p>
        </div>
      </section>

      <nav className="status-tabs" aria-label="Finding status">
        {tabs.map((tab) => (
          <Link
            className={`status-tab${page.status === tab.status ? ' status-tab-active' : ''}`}
            href={`/findings?status=${tab.status}`}
            key={tab.status}
          >
            {tab.label}
            <span>{page.counts[tab.status]}</span>
          </Link>
        ))}
      </nav>

      <section className="queue-region" aria-label="Findings">
        {page.findings.length === 0 ? (
          <Empty status={page.status} />
        ) : (
          <div className="candidate-list">
            {page.findings.map((finding) => (
              <FindingCard finding={finding} key={finding.id} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
