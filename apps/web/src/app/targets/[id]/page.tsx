import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { parseWeights } from '@kritt-radar/core';
import { prisma } from '@kritt-radar/db';
import { findTarget, type RankedTarget, type TargetSignal } from '../../../lib/target-ranking';
import { ConsoleNavbar } from '../../../components/console-navbar';
import { ScopeHandoff } from './scope-handoff';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: TargetRouteProps) {
  const { id } = await params;
  const scope = await prisma.scope.findUnique({ where: { id }, select: { hardKey: true } });
  return { title: scope?.hardKey ?? 'Target' };
}

interface TargetRouteProps {
  params: Promise<{ id: string }>;
}

const signalLabels: Record<string, string> = {
  audit_gap: 'Audit gap',
  freshness: 'Freshness',
  competition: 'Competition',
  value_at_risk: 'Value at risk',
};

const reasonExplanations: Record<string, string> = {
  no_public_audit: 'No audit was found for this project in the sources that have run.',
  audit_coverage_unknown: 'No audit source has run yet, so nothing is known either way.',
  snapshot_failed: 'The repository snapshot did not complete, so no gap was computed.',
  invalid_snapshot: 'The stored snapshot failed validation and was not trusted.',
  stale_cutoff: 'The snapshot was collected for a different audit cutoff than the current one.',
  no_snapshot: 'This scope has never been snapshotted.',
  no_commit_data: 'No commit history was available for this scope.',
};

function formatDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return `${new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(time),
  )} UTC`;
}

function SignalCard({ signal, contribution }: { signal: TargetSignal; contribution: number | null }) {
  const reason = typeof signal.evidence.reason === 'string' ? signal.evidence.reason : null;
  const since = formatDate(signal.evidence.sinceDate);
  const changedLoc = typeof signal.evidence.changedLoc === 'number' ? signal.evidence.changedLoc : null;
  const totalLoc = typeof signal.evidence.totalLoc === 'number' ? signal.evidence.totalLoc : null;

  return (
    <article className="signal-card">
      <header>
        <h3>{signalLabels[signal.type] ?? signal.type}</h3>
        <p className="data-value">{signal.value.toFixed(3)}</p>
      </header>

      <dl className="signal-facts">
        <div>
          <dt>Confidence</dt>
          <dd className="data-value">{signal.confidence.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Contributes</dt>
          <dd className="data-value">
            {contribution === null ? 'excluded' : `${contribution.toFixed(1)} pts`}
          </dd>
        </div>
        {since ? (
          <div>
            <dt>Since audit</dt>
            <dd className="data-value">{since}</dd>
          </div>
        ) : null}
        {changedLoc !== null && totalLoc !== null ? (
          <div>
            <dt>Churn</dt>
            <dd className="data-value">
              {changedLoc.toLocaleString('en')} / {totalLoc.toLocaleString('en')} loc
            </dd>
          </div>
        ) : null}
      </dl>

      {reason ? (
        <p className="signal-reason">{reasonExplanations[reason] ?? reason}</p>
      ) : null}
    </article>
  );
}

function contributionOf(target: RankedTarget, type: string): number | null {
  return target.score.breakdown.find((part) => part.type === type)?.contribution ?? null;
}

export default async function TargetRoute({ params }: TargetRouteProps) {
  const { id } = await params;
  const workspaceRoot = resolve(process.cwd(), '../..');
  const weights = parseWeights(await readFile(resolve(workspaceRoot, 'config/weights.yml'), 'utf8'));
  const target = await findTarget(prisma, weights, id);

  if (!target) notFound();

  return (
    <main className="page-shell" id="main-content">
      <ConsoleNavbar activeSection="targets" />

      <section className="route-heading">
        <div>
          <p className="breadcrumb">
            <Link href="/targets">Target ranking</Link>
          </p>
          <h1>{target.repoKey}</h1>
          <p>
            <a href={target.programUrl} rel="noreferrer" target="_blank">
              {target.programTitle}
            </a>{' '}
            on {target.platform}
          </p>
        </div>
        <p className="sync-time">
          <span>Score</span>
          <strong>{target.score.total.toFixed(1)}</strong>
        </p>
      </section>

      <section className="queue-region" aria-label="Scope handoff">
        <h2>Hand over to Open-Kritt</h2>
        <ScopeHandoff
          commitish={target.commitish}
          files={target.scopeFiles}
          repoKey={target.repoKey}
        />
      </section>

      <section className="queue-region" aria-label="Signal evidence">
        <h2>Signals</h2>
        <div className="signal-grid">
          {target.signals.map((signal) => (
            <SignalCard
              contribution={contributionOf(target, signal.type)}
              key={signal.type}
              signal={signal}
            />
          ))}
        </div>
        {target.score.skipped.length > 0 ? (
          <p className="signal-skipped">
            Excluded from the score for want of data:{' '}
            {target.score.skipped.map((type) => signalLabels[type] ?? type).join(', ')}. Their weight
            is redistributed across the signals that remain, so a gap in collection does not push a
            target down the list.
          </p>
        ) : null}
      </section>
    </main>
  );
}
