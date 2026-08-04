'use client';

import { useActionState, useState } from 'react';
import { decideFinding, type FindingDecisionState } from './actions';
import type { QueuedFinding } from '../../lib/finding-queue';

const initialState: FindingDecisionState = { status: 'idle', message: '' };

function Reward({ min, max }: { min: number | null; max: number | null }) {
  if (min === null && max === null) return <>Not estimated</>;
  const fmt = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`);
  if (min !== null && max !== null) return <>{`${fmt(min)} – ${fmt(max)}`}</>;
  return <>{fmt((min ?? max)!)}</>;
}

function DecisionButton({
  finding,
  status,
  label,
  variant,
}: {
  finding: QueuedFinding;
  status: string;
  label: string;
  variant: 'primary' | 'secondary';
}) {
  const [state, action, pending] = useActionState(decideFinding, initialState);

  return (
    <form action={action}>
      <input name="findingId" type="hidden" value={finding.id} />
      <input name="status" type="hidden" value={status} />
      <button className={`button-${variant}`} disabled={pending} type="submit">
        {pending ? 'Saving' : label}
      </button>
      <span className={`action-message action-message-${state.status}`} role="status">
        {state.message}
      </span>
    </form>
  );
}

export function FindingCard({ finding }: { finding: QueuedFinding }) {
  const [copied, setCopied] = useState(false);

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(finding.report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <article className="finding-card">
      <header className="finding-head">
        <div>
          <h2>{finding.title}</h2>
          <p className="finding-meta">
            <a href={finding.programUrl} rel="noreferrer" target="_blank">
              {finding.programTitle}
            </a>{' '}
            · {finding.platform} · <code>{finding.repoKey}</code>
            {finding.filePath ? (
              <>
                {' · '}
                <code>
                  {finding.filePath}
                  {finding.line ? `:${finding.line}` : ''}
                </code>
              </>
            ) : null}
          </p>
        </div>
        <dl className="finding-figures">
          <div>
            <dt>Impact</dt>
            <dd>{finding.impactLevel ?? finding.severity ?? '—'}</dd>
          </div>
          <div>
            <dt>Expected</dt>
            <dd className="data-value">
              <Reward max={finding.maxRewardUsd} min={finding.minRewardUsd} />
            </dd>
          </div>
        </dl>
      </header>

      {/* Shown before the controls, never after: the operator should meet the
          gaps while deciding, not after they have decided. */}
      {finding.blockers.length > 0 ? (
        <p className="finding-blockers">
          Not ready to submit: {finding.blockers.join(', ')}.
        </p>
      ) : null}

      {finding.rankReasoning ? <p className="finding-reasoning">{finding.rankReasoning}</p> : null}

      <details className="finding-report">
        <summary>Draft report</summary>
        <div className="finding-report-actions">
          <button className="button-secondary" onClick={copyReport} type="button">
            {copied ? 'Copied' : 'Copy report'}
          </button>
        </div>
        <textarea aria-label="Draft report" readOnly rows={18} value={finding.report} />
      </details>

      <div className="finding-decisions">
        {finding.status !== 'submitted' ? (
          <DecisionButton
            finding={finding}
            label="Mark submitted"
            status="submitted"
            variant="primary"
          />
        ) : null}
        {finding.status !== 'dismissed' ? (
          <DecisionButton
            finding={finding}
            label="Dismiss"
            status="dismissed"
            variant="secondary"
          />
        ) : null}
        {finding.status !== 'new' ? (
          <DecisionButton finding={finding} label="Reopen" status="new" variant="secondary" />
        ) : null}
      </div>
    </article>
  );
}
