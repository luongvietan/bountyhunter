import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Link from 'next/link';
import { parseWeights } from '@kritt-radar/core';
import { prisma } from '@kritt-radar/db';
import { isDatabaseSetupError } from '../merge-queue/database-setup';
import { listRankedTargets, type RankedTarget, type TargetRankingPage } from '../../lib/target-ranking';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Target ranking' };

interface TargetsRouteProps {
  searchParams: Promise<{ platform?: string | string[]; measured?: string | string[] }>;
}

const signalLabels: Record<string, string> = {
  audit_gap: 'Audit gap',
  freshness: 'Freshness',
  competition: 'Competition',
  value_at_risk: 'Value at risk',
};

const reasonLabels: Record<string, string> = {
  no_public_audit: 'No audit found',
  audit_coverage_unknown: 'Audit sources not run',
  snapshot_failed: 'Snapshot failed',
  invalid_snapshot: 'Snapshot unusable',
  stale_cutoff: 'Snapshot predates cutoff',
  no_snapshot: 'Not snapshotted',
  no_commit_data: 'No commit data',
};

function formatPool(value: number | null): string {
  if (value === null) return '—';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${value}`;
}

async function loadWeights() {
  const workspaceRoot = resolve(process.cwd(), '../..');
  return parseWeights(await readFile(resolve(workspaceRoot, 'config/weights.yml'), 'utf8'));
}

function filterHref(
  page: TargetRankingPage,
  next: { platform?: string | null; measured?: boolean },
): string {
  const params = new URLSearchParams();
  const platform = next.platform === undefined ? page.filters.platform : next.platform;
  const measured = next.measured === undefined ? page.filters.measuredOnly : next.measured;
  if (platform) params.set('platform', platform);
  if (measured) params.set('measured', '1');
  const query = params.toString();
  return query ? `/targets?${query}` : '/targets';
}

function TargetRow({ target, rank }: { target: RankedTarget; rank: number }) {
  const reason = target.auditGapReason ? reasonLabels[target.auditGapReason] ?? target.auditGapReason : null;

  return (
    <li className="target-row">
      <span className="target-rank">{rank}</span>
      <span className="target-score">{target.score.total.toFixed(1)}</span>
      <span className="target-identity">
        <Link href={`/targets/${target.scopeId}`}>{target.repoKey}</Link>
        <span className="target-program">
          {target.programTitle} · {target.platform}
          {target.programs.length > 1 ? (
            <span className="target-alsoin">+{target.programs.length - 1} more</span>
          ) : null}
        </span>
      </span>
      <span className="target-signals">
        {target.score.breakdown.map((part) => (
          <span className="signal-pill" key={part.type}>
            <span className="signal-pill-label">{signalLabels[part.type] ?? part.type}</span>
            <span className="signal-pill-value">{part.value.toFixed(2)}</span>
          </span>
        ))}
        {reason ? <span className="signal-pill signal-pill-assumed">{reason}</span> : null}
      </span>
      <span className="target-pool">{formatPool(target.poolUsd)}</span>
      <span className="target-files">
        {target.scopeFiles.length > 0 ? `${target.scopeFiles.length} files` : '—'}
      </span>
    </li>
  );
}

function EmptyState({ page }: { page: TargetRankingPage }) {
  return (
    <div className="empty-state">
      <h2>No targets match these filters</h2>
      <p>
        {page.totals.all} repositories are ranked in total, {page.totals.measured} of them with a measured
        audit gap. Clear the filters to see the full list.
      </p>
      <Link className="button-secondary" href="/targets">
        Clear filters
      </Link>
    </div>
  );
}

function SetupState() {
  return (
    <main className="page-shell setup-shell" id="main-content">
      <section className="setup-panel">
        <h1>Connect the evidence database</h1>
        <p>Target ranking is unavailable until PostgreSQL is running and the local data is prepared.</p>
        <pre>
          <code>docker compose up -d postgres{'\n'}pnpm migrate{'\n'}pnpm sync</code>
        </pre>
      </section>
    </main>
  );
}

export default async function TargetsRoute({ searchParams }: TargetsRouteProps) {
  const raw = await searchParams;

  let page: TargetRankingPage;
  try {
    page = await listRankedTargets(prisma, await loadWeights(), raw);
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
          <Link href="/targets" aria-current="page">
            Targets
          </Link>
          <Link href="/merge-queue">Merge queue</Link>
        </nav>
      </header>

      <section className="route-heading">
        <div>
          <h1>Target ranking</h1>
          <p>
            Repository scopes ordered by how much has changed since their last known audit. A
            measured gap outranks an assumed one, so the top of this list is where evidence is,
            not where information is missing.
          </p>
        </div>
        <p className="sync-time">
          <span>Weights</span>
          <strong>{page.weightsVersion}</strong>
        </p>
      </section>

      <nav className="filter-bar" aria-label="Target filters">
        <Link
          className={`filter-chip${page.filters.platform === null ? ' filter-chip-active' : ''}`}
          href={filterHref(page, { platform: null })}
        >
          All platforms
        </Link>
        {page.platforms.map((platform) => (
          <Link
            className={`filter-chip${page.filters.platform === platform ? ' filter-chip-active' : ''}`}
            href={filterHref(page, { platform })}
            key={platform}
          >
            {platform}
          </Link>
        ))}
        <Link
          className={`filter-chip filter-chip-measured${page.filters.measuredOnly ? ' filter-chip-active' : ''}`}
          href={filterHref(page, { measured: !page.filters.measuredOnly })}
        >
          Measured audit gap only
          <span>{page.totals.measured}</span>
        </Link>
      </nav>

      <section className="queue-region" aria-label="Ranked targets">
        <p className="result-count">
          Showing {page.totals.shown} of {page.totals.all} repositories
        </p>

        {page.targets.length === 0 ? (
          <EmptyState page={page} />
        ) : (
          <ol className="target-table">
            <li className="target-row target-head" aria-hidden="true">
              <span>#</span>
              <span>Score</span>
              <span>Target</span>
              <span>Signals</span>
              <span>Pool</span>
              <span>Scope</span>
            </li>
            {page.targets.map((target, index) => (
              <TargetRow key={target.scopeId} rank={index + 1} target={target} />
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
