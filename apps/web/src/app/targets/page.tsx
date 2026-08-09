import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Link from 'next/link';
import { parseExclusions, parseWeights } from '@kritt-radar/core';
import { prisma } from '@kritt-radar/db';
import { workspaceRoot } from '../../lib/workspace-root';
import { isDatabaseSetupError } from '../merge-queue/database-setup';
import { ConsoleNavbar } from '../../components/console-navbar';
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
  return parseWeights(await readFile(resolve(workspaceRoot(), 'config/weights.yml'), 'utf8'));
}

async function loadExclusions() {
  // Missing file means nothing is excluded, which is a safe default: the list
  // gets noisier, never quietly shorter.
  const text = await readFile(resolve(workspaceRoot(), 'config/exclusions.yml'), 'utf8').catch(
    () => 'owners: []',
  );
  return parseExclusions(text);
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
      <span className="target-score">
        {target.score.total.toFixed(1)}
        {/* The ceiling, spelled out: a score is only as high as the share of
            the scale we actually measured. */}
        <span className="target-coverage" title={`${Math.round(target.score.coverage * 100)}% of the scale measured`}>
          {target.score.breakdown.length}/{target.score.breakdown.length + target.missingSignals.length}
        </span>
      </span>
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
        {/* Absent signals stay on the row rather than vanishing, so a low score
            reads as "not measured" rather than "not worth scanning". */}
        {target.missingSignals.map((type) => (
          <span className="signal-pill signal-pill-missing" key={type}>
            <span className="signal-pill-label">{signalLabels[type] ?? type}</span>
            <span className="signal-pill-value">not measured</span>
          </span>
        ))}
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
      <ConsoleNavbar activeSection="targets" />
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
    page = await listRankedTargets(prisma, await loadWeights(), raw, await loadExclusions());
  } catch (error) {
    if (isDatabaseSetupError(error, process.env.DATABASE_URL)) return <SetupState />;
    throw error;
  }

  return (
    <main className="page-shell" id="main-content">
      <ConsoleNavbar activeSection="targets" />

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
          {/* Never shrink the list without saying so. */}
          {page.totals.closed + page.totals.excludedOwner > 0 ? (
            <span className="result-excluded">
              {' · '}
              {page.totals.closed} scope{page.totals.closed === 1 ? '' : 's'} hidden as closed
              programs, {page.totals.excludedOwner} as mirror or audit-firm repositories
            </span>
          ) : null}
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
