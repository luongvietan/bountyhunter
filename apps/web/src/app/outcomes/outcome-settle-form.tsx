'use client';

import React, { useActionState } from 'react';
import { settleOutcome, type OutcomeActionState } from './actions';

const initialState: OutcomeActionState = { status: 'idle', message: '' };

const resultOptions = [
  { value: 'accepted', label: 'Accepted' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'invalid', label: 'Invalid' },
] as const;

/**
 * Settle one pending outcome in place. Kept next to the row it changes so the
 * submission it settles stays on screen while the operator picks a result.
 */
export function OutcomeSettleForm({ outcomeId }: { outcomeId: string }) {
  const [state, formAction, pending] = useActionState(settleOutcome, initialState);

  return (
    <form action={formAction} className="outcome-settle">
      <input name="outcomeId" type="hidden" value={outcomeId} />

      <label className="sr-only" htmlFor={`result-${outcomeId}`}>
        Result
      </label>
      <select defaultValue="accepted" disabled={pending} id={`result-${outcomeId}`} name="result">
        {resultOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor={`payout-${outcomeId}`}>
        Payout in USD
      </label>
      <input
        disabled={pending}
        id={`payout-${outcomeId}`}
        min="0"
        name="payoutUsd"
        placeholder="Payout"
        step="0.01"
        type="number"
      />

      <button className="button-secondary" disabled={pending} type="submit">
        {pending ? 'Saving…' : 'Record'}
      </button>

      <span aria-live="polite" className={`action-message action-message-${state.status}`} role="status">
        {state.message}
      </span>
    </form>
  );
}
