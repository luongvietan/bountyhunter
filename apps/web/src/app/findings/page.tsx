import Link from 'next/link';
import { prisma } from '@kritt-radar/db';
import { ConsoleNavbar } from '../../components/console-navbar';
import { isDatabaseSetupError } from '../merge-queue/database-setup';
import {
  filterHref,
  listFindingQueue,
  parseFindingFilters,
  parseFindingStatus,
  type BlockerFilter,
  type FindingQueuePage,
  type FindingStatus,
  type IngestBadge,
} from '../../lib/finding-queue';
import { FindingCard } from './finding-card';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Findings' };

interface FindingsRouteProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const tabs: Array<{ status: FindingStatus; label: string }> = [
  { status: 'new', label: 'New' },
  { status: 'reviewed', label: 'Reviewed' },
  { status: 'submitted', label: 'Submitted' },
  { status: 'dismissed', label: 'Dismissed' },
];

const rankOptions = [1, 2, 3, 5, 10];

const blockerOptions: Array<{ value: BlockerFilter; label: string }> = [
  { value: 'any', label: 'Any blocker' },
  { value: 'none', label: 'No blockers' },
  { value: 'No proof of concept', label: 'No PoC' },
  { value: 'Exploitability not confirmed', label: 'Not exploitable' },
  { value: 'No written explanation', label: 'No explanation' },
  { value: 'Attacker is out of scope for this program', label: 'Out of scope' },
  { value: 'Post-script could not confirm the finding', label: 'Post-script failed' },
];

const ingestOptions: Array<{ value: IngestBadge; label: string }> = [
  { value: 'unseen', label: 'New since ingest' },
  { value: 'updated', label: 'Updated since view' },
  { value: 'seen', label: 'Already viewed' },
];

const decidedByOptions = [
  { value: 'operator', label: 'Operator' },
  { value: 'auto', label: 'Auto dismissed' },
  { value: 'ai', label: 'AI dismissed' },
] as const;

function Empty({ status }: { status: FindingStatus }) {
  return (
    <div className="empty-state">
      <h2>Nothing here yet</h2>
      {status === 'new' ? (
        <p>
          Findings appear after a scan completes. Run{' '}
          <code>pnpm automate</code> or hand targets to Open-Kritt with{' '}
          <code>pnpm dispatch --apply</code>, then pull results with{' '}
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
      <ConsoleNavbar activeSection="findings" />
      <section className="setup-panel">
        <h1>Connect the evidence database</h1>
        <p>The findings queue is unavailable until PostgreSQL is running.</p>
      </section>
    </main>
  );
}

function FilterBar({ page }: { page: FindingQueuePage }) {
  const { filters, status, severities, programs } = page;

  return (
    <nav className="filter-bar finding-filters" aria-label="Finding filters">
      {severities.map((severity) => (
        <Link
          className={`filter-chip${filters.severity === severity ? ' filter-chip-active' : ''}`}
          href={filterHref(status, filters, {
            severity: filters.severity === severity ? null : severity,
          })}
          key={severity}
        >
          {severity}
        </Link>
      ))}

      {rankOptions.map((rank) => (
        <Link
          className={`filter-chip${filters.maxBountyRank === rank ? ' filter-chip-active' : ''}`}
          href={filterHref(status, filters, {
            rank: filters.maxBountyRank === rank ? null : rank,
          })}
          key={rank}
        >
          Rank ≤ {rank}
        </Link>
      ))}

      {programs.slice(0, 8).map((program) => (
        <Link
          className={`filter-chip${filters.programId === program.id ? ' filter-chip-active' : ''}`}
          href={filterHref(status, filters, {
            program: filters.programId === program.id ? null : program.id,
          })}
          key={program.id}
        >
          {program.title.length > 28 ? `${program.title.slice(0, 26)}…` : program.title}
        </Link>
      ))}

      {blockerOptions.map((option) => (
        <Link
          className={`filter-chip${(filters.blocker ?? 'any') === option.value ? ' filter-chip-active' : ''}`}
          href={filterHref(status, filters, {
            blocker:
              (filters.blocker ?? 'any') === option.value && option.value !== 'any'
                ? null
                : option.value,
          })}
          key={option.value}
        >
          {option.label}
        </Link>
      ))}

      {ingestOptions.map((option) => (
        <Link
          className={`filter-chip${filters.ingest === option.value ? ' filter-chip-active' : ''}`}
          href={filterHref(status, filters, {
            ingest: filters.ingest === option.value ? null : option.value,
          })}
          key={option.value}
        >
          {option.label}
        </Link>
      ))}

      {status === 'dismissed'
        ? decidedByOptions.map((option) => (
            <Link
              className={`filter-chip${filters.decidedBy === option.value ? ' filter-chip-active' : ''}`}
              href={filterHref(status, filters, {
                decidedBy: filters.decidedBy === option.value ? null : option.value,
              })}
              key={option.value}
            >
              {option.label}
            </Link>
          ))
        : null}

      {Object.keys(filters).length > 0 ? (
        <Link className="filter-chip" href={`/findings?status=${status}`}>
          Clear filters
        </Link>
      ) : null}
    </nav>
  );
}

export default async function FindingsRoute({ searchParams }: FindingsRouteProps) {
  const raw = await searchParams;
  const status = parseFindingStatus(raw.status);
  const filters = parseFindingFilters(raw);

  let page: FindingQueuePage;
  try {
    page = await listFindingQueue(prisma, status, filters);
  } catch (error) {
    if (isDatabaseSetupError(error, process.env.DATABASE_URL)) return <SetupState />;
    throw error;
  }

  return (
    <main className="page-shell" id="main-content">
      <ConsoleNavbar activeSection="findings" />

      <section className="route-heading">
        <div>
          <h1>Findings</h1>
          <p>
            Compare inline source against the GitHub permalink, filter by severity and bounty rank,
            and spot findings that changed since you last viewed them after ingest.
          </p>
        </div>
      </section>

      <nav className="status-tabs" aria-label="Finding status">
        {tabs.map((tab) => (
          <Link
            className={`status-tab${page.status === tab.status ? ' status-tab-active' : ''}`}
            href={filterHref(tab.status, page.filters, {})}
            key={tab.status}
          >
            {tab.label}
            <span>{page.counts[tab.status]}</span>
          </Link>
        ))}
      </nav>

      <FilterBar page={page} />

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
