import type { ParsedFinding } from './finding-parse.js';

export type TriageActor = 'auto' | 'ai';

export interface TriageVerdict {
  dismiss: boolean;
  decidedBy: TriageActor | null;
  reason: string | null;
}

const AUTO_DISMISS_VERDICTS = new Set(['noise', 'invalid']);

/**
 * Decide whether a finding should be auto-dismissed after ingest.
 * Rule-based signals use decidedBy=auto; Finding Triage post-script uses ai.
 */
export function triageDismissVerdict(finding: ParsedFinding): TriageVerdict {
  if (finding.inScope === false) {
    return {
      dismiss: true,
      decidedBy: 'auto',
      reason: 'Attacker is out of scope for this program.',
    };
  }
  if (finding.postScriptValid === false) {
    return {
      dismiss: true,
      decidedBy: 'auto',
      reason: 'Post-script could not confirm the finding.',
    };
  }

  const verdict = finding.triageVerdict?.trim().toLowerCase();
  if (verdict && AUTO_DISMISS_VERDICTS.has(verdict)) {
    return {
      dismiss: true,
      decidedBy: 'ai',
      reason: `Finding Triage: ${verdict}${finding.triageReason ? ` — ${finding.triageReason}` : '.'}`,
    };
  }

  return { dismiss: false, decidedBy: null, reason: null };
}

export function autoTriageEnabled(): boolean {
  return process.env.RADAR_AUTO_TRIAGE !== 'false';
}
