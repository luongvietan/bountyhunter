import React from 'react';
import { SIGNAL_TYPES } from '@kritt-radar/core';
import type { CorrelationReport, SignalCorrelation } from '../../lib/outcome-correlation';

const signalLabels: Record<string, string> = {
  audit_gap: 'Audit gap',
  freshness: 'Freshness',
  competition: 'Competition',
  value_at_risk: 'Value at risk',
};

function formatCoefficient(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}

function formatPayout(value: number | null): string {
  if (value === null) return '—';
  return `$${value.toLocaleString('en', { maximumFractionDigits: 0 })}`;
}

function SignalCorrelationCard({ label, stats }: { label: string; stats: SignalCorrelation }) {
  return (
    <article className="correlation-card" aria-labelledby={undefined}>
      <header>
        <h3>{label}</h3>
        <span className="data-value">n={stats.sampleSize}</span>
      </header>

      {stats.unstable ? (
        <p className="correlation-banner" role="note">
          Insufficient samples ({stats.sampleSize} of the 5 required). Coefficients below are not
          reliable yet.
        </p>
      ) : null}

      <dl className="correlation-facts">
        <div>
          <dt>Pearson</dt>
          <dd className="data-value">{formatCoefficient(stats.pearson)}</dd>
        </div>
        <div>
          <dt>Spearman</dt>
          <dd className="data-value">{formatCoefficient(stats.spearman)}</dd>
        </div>
      </dl>

      <table className="tertile-table">
        <caption className="sr-only">Average payout by signal tertile</caption>
        <thead>
          <tr>
            <th scope="col">Tertile</th>
            <th scope="col">Count</th>
            <th scope="col">Avg payout</th>
          </tr>
        </thead>
        <tbody>
          {stats.tertiles.map((tertile) => (
            <tr key={tertile.label}>
              <td>{tertile.label}</td>
              <td className="data-value">{tertile.count}</td>
              <td className="data-value">{formatPayout(tertile.avgPayoutUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

export function CorrelationPanel({
  correlation,
  minConfidence,
}: {
  correlation: CorrelationReport;
  minConfidence: number;
}) {
  return (
    <section aria-labelledby="correlation-title" className="correlation-panel">
      <header className="correlation-panel-head">
        <h2 id="correlation-title">Signal / payout correlation</h2>
        <p>
          Computed from outcomes with a paid-out result and a signal snapshot at or above the
          configured confidence floor ({minConfidence.toFixed(2)}).
        </p>
      </header>
      <div className="correlation-grid">
        {SIGNAL_TYPES.map((type) => {
          const stats = correlation.bySignal[type];
          if (!stats) return null;
          return (
            <SignalCorrelationCard key={type} label={signalLabels[type] ?? type} stats={stats} />
          );
        })}
      </div>
    </section>
  );
}
