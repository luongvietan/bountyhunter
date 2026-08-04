'use client';

import React, { useActionState } from 'react';
import type { ScopeOption } from '../../lib/outcomes';
import { submitOutcome, type OutcomeActionState } from './actions';

const initialState: OutcomeActionState = { status: 'idle', message: '' };

const actionOptions = [
  { value: 'scan', label: 'Scan' },
  { value: 'submit', label: 'Submit' },
  { value: 'note', label: 'Note' },
] as const;

const resultOptions = [
  { value: 'accepted', label: 'Accepted' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'invalid', label: 'Invalid' },
  { value: 'pending', label: 'Pending' },
] as const;

function nowLocalDateTime(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

interface OutcomeFormProps {
  scopeOptions: ScopeOption[];
}

export function OutcomeForm({ scopeOptions }: OutcomeFormProps) {
  const [state, formAction, pending] = useActionState(submitOutcome, initialState);

  if (scopeOptions.length === 0) {
    return (
      <p className="empty-inline">
        No scopes are available yet. Run the sync pipeline before recording outcomes.
      </p>
    );
  }

  return (
    <form action={formAction} className="outcome-form">
      <div className="form-grid">
        <label className="form-field">
          <span>Scope</span>
          <select defaultValue={scopeOptions[0]!.id} disabled={pending} name="scopeId" required>
            {scopeOptions.map((scope) => (
              <option key={scope.id} value={scope.id}>
                {scope.title} · {scope.platform}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>Action</span>
          <select defaultValue="submit" disabled={pending} name="action" required>
            {actionOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>Result</span>
          <select defaultValue="accepted" disabled={pending} name="result" required>
            {resultOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>Submitted at</span>
          <input
            defaultValue={nowLocalDateTime()}
            disabled={pending}
            name="submittedAt"
            required
            type="datetime-local"
          />
        </label>

        <label className="form-field">
          <span>Payout (USD)</span>
          <input disabled={pending} min="0" name="payoutUsd" placeholder="Optional" step="0.01" type="number" />
        </label>

        <label className="form-field form-field-wide">
          <span>Notes</span>
          <input disabled={pending} name="notes" placeholder="Optional" type="text" />
        </label>
      </div>

      <button className="button-primary" disabled={pending} type="submit">
        {pending ? 'Recording…' : 'Record outcome'}
      </button>

      <p aria-live="polite" className={`action-message action-message-${state.status}`} role="status">
        {state.message}
      </p>
    </form>
  );
}
