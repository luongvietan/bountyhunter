import type { SignalType, Weights } from '@kritt-radar/core';
import { SIGNAL_TYPES } from '@kritt-radar/core';
import type { PrismaClient } from '@kritt-radar/db';
import {
  correlateOutcomes,
  type CorrelationReport,
  type OutcomeCorrRow,
  type SnapshotSignal,
} from './outcome-correlation';

export type OutcomeResultFilter = 'all' | 'accepted' | 'duplicate' | 'invalid' | 'pending';

export interface OutcomeRow {
  id: string;
  scopeId: string;
  title: string;
  platform: string;
  action: string;
  result: string;
  submittedAt: string;
  payoutUsd: number | null;
  notes: string | null;
  /** Set when a submitted finding opened this row, rather than a person. */
  findingId: string | null;
}

export interface ScopeOption {
  id: string;
  title: string;
  platform: string;
}

export interface OutcomesPage {
  resultFilter: OutcomeResultFilter;
  outcomes: OutcomeRow[];
  scopeOptions: ScopeOption[];
  correlation: CorrelationReport;
  minConfidence: number;
}

const resultFilters: readonly OutcomeResultFilter[] = ['all', 'accepted', 'duplicate', 'invalid', 'pending'];

function isResultFilter(value: string): value is OutcomeResultFilter {
  return (resultFilters as readonly string[]).includes(value);
}

export function parseResultFilter(value: string | string[] | undefined): OutcomeResultFilter {
  return typeof value === 'string' && isResultFilter(value) ? value : 'all';
}

function parseSignalSnapshot(value: unknown): Record<string, SnapshotSignal> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const snapshot: Record<string, SnapshotSignal> = {};
  for (const [type, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.value !== 'number' || typeof entry.confidence !== 'number') continue;
    snapshot[type] = { value: entry.value, confidence: entry.confidence };
  }
  return snapshot;
}

function toNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export async function listOutcomesPage(
  prisma: PrismaClient,
  weights: Weights,
  resultFilter: OutcomeResultFilter,
): Promise<OutcomesPage> {
  const [outcomes, scopes] = await Promise.all([
    prisma.outcome.findMany({
      ...(resultFilter === 'all' ? {} : { where: { result: resultFilter } }),
      orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
      include: { scope: { include: { program: true } } },
    }),
    prisma.scope.findMany({
      include: { program: true },
      orderBy: [{ program: { title: 'asc' } }, { id: 'asc' }],
    }),
  ]);

  const correlationRows: OutcomeCorrRow[] = outcomes.map((outcome) => ({
    payoutUsd: toNumber(outcome.payoutUsd),
    signals: parseSignalSnapshot(outcome.signalSnapshot),
  }));
  const correlation = correlateOutcomes(
    correlationRows,
    SIGNAL_TYPES as readonly SignalType[],
    weights.minConfidence,
  );

  return {
    resultFilter,
    outcomes: outcomes.map((outcome) => ({
      id: outcome.id,
      scopeId: outcome.scopeId,
      title: outcome.scope.program.title,
      platform: outcome.scope.program.platform,
      action: outcome.action,
      result: outcome.result,
      submittedAt: outcome.submittedAt.toISOString(),
      payoutUsd: toNumber(outcome.payoutUsd),
      notes: outcome.notes,
      findingId: outcome.findingId,
    })),
    scopeOptions: scopes.map((scope) => ({
      id: scope.id,
      title: scope.program.title,
      platform: scope.program.platform,
    })),
    correlation,
    minConfidence: weights.minConfidence,
  };
}
