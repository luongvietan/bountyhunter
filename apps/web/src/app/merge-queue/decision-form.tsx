'use client';

import React, { useActionState, useState } from 'react';
import type { QueueCandidate } from '../../lib/merge-queue';
import { submitMergeDecision, type DecisionActionState } from './actions';

const initialState: DecisionActionState = { status: 'idle', message: '' };

interface DecisionFormProps {
  candidate: QueueCandidate;
}

export function DecisionForm({ candidate }: DecisionFormProps) {
  const [approvalState, approvalAction, approvalPending] = useActionState(
    submitMergeDecision,
    initialState,
  );
  const [secondaryState, secondaryAction, secondaryPending] = useActionState(
    submitMergeDecision,
    initialState,
  );
  const [confirmed, setConfirmed] = useState(false);

  if (candidate.status === 'approved') {
    return (
      <p className="decision-locked">
        <span aria-hidden="true">✓</span> Decision locked. Approved matches cannot be reopened.
      </p>
    );
  }

  if (candidate.status === 'rejected') {
    return (
      <form action={secondaryAction} className="decision-form">
        <input name="candidateId" type="hidden" value={candidate.id} />
        <input name="action" type="hidden" value="reopen" />
        <div className="decision-row">
          <p>Return this candidate to the pending queue without changing entity evidence.</p>
          <button className="button-secondary" disabled={secondaryPending} type="submit">
            {secondaryPending ? 'Reopening…' : 'Reopen review'}
          </button>
        </div>
        <ActionMessage state={secondaryState} />
      </form>
    );
  }

  const sourceName = candidate.source?.canonicalName ?? 'the provisional entity';
  const targetName = candidate.target?.canonicalName ?? 'the canonical entity';
  const aliasCount = candidate.source?.projectHints.length ?? 0;
  const reportCount = candidate.source?.auditReportCount ?? 0;
  const anyPending = approvalPending || secondaryPending;

  return (
    <>
      {candidate.approvable && candidate.source && candidate.target ? (
        <form action={approvalAction} className="decision-form">
          <input name="candidateId" type="hidden" value={candidate.id} />
          <input name="action" type="hidden" value="approve" />
          <div className="approval-panel">
            <p className="consequence-copy">
              Approval creates {aliasCount} manual audit {aliasCount === 1 ? 'alias' : 'aliases'} and
              moves {reportCount} {reportCount === 1 ? 'report' : 'reports'} from{' '}
              <strong>{sourceName}</strong> to <strong>{targetName}</strong>.
            </p>
            <label className="confirmation-control">
              <input
                checked={confirmed}
                disabled={anyPending}
                name="confirmed"
                onChange={(event) => setConfirmed(event.target.checked)}
                required
                type="checkbox"
              />
              <span>
                Confirm moving evidence from {sourceName} to {targetName}.
              </span>
            </label>
            <button
              className="button-primary"
              disabled={!confirmed || anyPending}
              type="submit"
            >
              {approvalPending ? 'Saving decision…' : 'Approve match'}
            </button>
          </div>
          <ActionMessage state={approvalState} />
        </form>
      ) : null}

      <form action={secondaryAction} className="decision-form">
        <input name="candidateId" type="hidden" value={candidate.id} />
        <input name="action" type="hidden" value="reject" />
        <div className="reject-row">
          <p>Rejection records the decision and leaves aliases, reports, and entities unchanged.</p>
          <button
            className="button-secondary button-reject"
            disabled={anyPending}
            type="submit"
          >
            {secondaryPending ? 'Saving decision…' : 'Reject match'}
          </button>
        </div>
        <ActionMessage state={secondaryState} />
      </form>
    </>
  );
}

function ActionMessage({ state }: { state: DecisionActionState }) {
  return (
    <p
      aria-live="polite"
      className={`action-message action-message-${state.status}`}
      role="status"
    >
      {state.message}
    </p>
  );
}
