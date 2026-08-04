import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Link from 'next/link';
import { parseWeights } from '@kritt-radar/core';
import { prisma } from '@kritt-radar/db';
import { ConsoleNavbar } from '../../components/console-navbar';
import { isDatabaseSetupError } from '../merge-queue/database-setup';
import { listOutcomesPage, parseResultFilter, type OutcomeResultFilter, type OutcomesPage } from '../../lib/outcomes';
import { CorrelationPanel } from './correlation-panel';
import { OutcomeForm } from './outcome-form';
import { OutcomeHistory } from './outcome-history';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Outcomes' };

interface OutcomesRouteProps {
  searchParams: Promise<{ result?: string | string[] }>;
}

const resultTabLabels: Record<OutcomeResultFilter, string> = {
  all: 'All',
  accepted: 'Accepted',
  duplicate: 'Duplicate',
  invalid: 'Invalid',
  pending: 'Pending',
};

async function loadWeights() {
  const workspaceRoot = resolve(process.cwd(), '../..');
  return parseWeights(await readFile(resolve(workspaceRoot, 'config/weights.yml'), 'utf8'));
}

function SetupState() {
  return (
    <main className="page-shell setup-shell" id="main-content">
      <ConsoleNavbar activeSection="outcomes" />
      <section className="setup-panel" aria-labelledby="setup-title">
        <span className="setup-index" aria-hidden="true">DB</span>
        <div>
          <h1 id="setup-title">Connect the evidence database</h1>
          <p>Outcomes are unavailable until PostgreSQL is running and the local data is prepared.</p>
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

function OutcomesScreen({ page }: { page: OutcomesPage }) {
  return (
    <main className="page-shell" id="main-content">
      <ConsoleNavbar activeSection="outcomes" />

      <section className="route-heading" aria-labelledby="page-title">
        <div>
          <h1 id="page-title">Outcomes</h1>
          <p>
            Record bounty submissions and their results, then watch how each signal correlates
            with what actually pays out.
          </p>
        </div>
      </section>

      <section aria-labelledby="record-title">
        <h2 id="record-title" className="sr-only">Record an outcome</h2>
        <OutcomeForm scopeOptions={page.scopeOptions} />
      </section>

      <nav className="filter-bar" aria-label="Outcome result filters">
        {(Object.keys(resultTabLabels) as OutcomeResultFilter[]).map((result) => (
          <Link
            className={`filter-chip${page.resultFilter === result ? ' filter-chip-active' : ''}`}
            href={result === 'all' ? '/outcomes' : `/outcomes?result=${result}`}
            key={result}
          >
            {resultTabLabels[result]}
          </Link>
        ))}
      </nav>

      <section aria-label="Outcome history" className="queue-region">
        <OutcomeHistory outcomes={page.outcomes} />
      </section>

      <CorrelationPanel correlation={page.correlation} minConfidence={page.minConfidence} />
    </main>
  );
}

export default async function OutcomesRoute({ searchParams }: OutcomesRouteProps) {
  const params = await searchParams;
  const resultFilter = parseResultFilter(params.result);

  if (!process.env.DATABASE_URL) return <SetupState />;

  try {
    const weights = await loadWeights();
    const page = await listOutcomesPage(prisma, weights, resultFilter);
    return <OutcomesScreen page={page} />;
  } catch (error) {
    if (isDatabaseSetupError(error, process.env.DATABASE_URL)) return <SetupState />;
    throw error;
  }
}
