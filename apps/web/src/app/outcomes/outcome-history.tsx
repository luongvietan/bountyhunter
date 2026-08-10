import React from 'react';
import type { OutcomeRow } from '../../lib/outcomes';
import { OutcomeSettleForm } from './outcome-settle-form';

const dateFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

function formatDate(value: string): string {
  return `${dateFormatter.format(new Date(value))} UTC`;
}

function formatPayout(value: number | null): string {
  if (value === null) return '—';
  return `$${value.toLocaleString('en', { maximumFractionDigits: 2 })}`;
}

export function OutcomeHistory({ outcomes }: { outcomes: OutcomeRow[] }) {
  if (outcomes.length === 0) {
    return (
      <div className="empty-state">
        <span aria-hidden="true">∅</span>
        <div>
          <h2>No outcomes recorded</h2>
          <p>Record the first outcome above to start building the payout correlation sample.</p>
        </div>
      </div>
    );
  }

  return (
    <table className="outcome-table">
      <thead>
        <tr>
          <th scope="col">Submitted</th>
          <th scope="col">Target</th>
          <th scope="col">Action</th>
          <th scope="col">Result</th>
          <th scope="col">Payout</th>
          <th scope="col">Notes</th>
        </tr>
      </thead>
      <tbody>
        {outcomes.map((outcome) => (
          <tr key={outcome.id}>
            <td className="data-value">
              <time dateTime={outcome.submittedAt}>{formatDate(outcome.submittedAt)}</time>
            </td>
            <td>
              {outcome.title} <span className="outcome-platform">{outcome.platform}</span>
              {outcome.findingId ? <span className="outcome-origin">from a finding</span> : null}
            </td>
            <td>{outcome.action}</td>
            <td>
              <span className={`result-chip result-${outcome.result}`}>{outcome.result}</span>
              {/* A pending row is a submission whose result nobody has entered
                  yet, and it contributes nothing to correlation until they do. */}
              {outcome.result === 'pending' ? <OutcomeSettleForm outcomeId={outcome.id} /> : null}
            </td>
            <td className="data-value">{formatPayout(outcome.payoutUsd)}</td>
            <td className="outcome-notes">{outcome.notes ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
