import { score, type ScoreResult, type SignalValue, type Weights } from '@kritt-radar/core';

export interface ScopeSignals {
  scopeId: string;
  title: string;
  signals: readonly SignalValue[];
}

export interface RankedScope {
  scopeId: string;
  title: string;
  score: ScoreResult;
}

/** Chấm điểm và xếp hạng. Thuần — không I/O, nên replay được trên dữ liệu cũ. */
export function rankScopes(scopes: readonly ScopeSignals[], weights: Weights): RankedScope[] {
  return scopes
    .map((s) => ({ scopeId: s.scopeId, title: s.title, score: score(s.signals, weights) }))
    .sort((a, b) => b.score.total - a.score.total);
}
