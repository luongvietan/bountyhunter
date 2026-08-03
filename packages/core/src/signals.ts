export const SIGNAL_TYPES = ['audit_gap', 'freshness', 'competition', 'value_at_risk'] as const;

export type SignalType = (typeof SIGNAL_TYPES)[number];

export function isSignalType(v: string): v is SignalType {
  return (SIGNAL_TYPES as readonly string[]).includes(v);
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export interface SignalValue {
  type: SignalType;
  /** Sức mạnh tín hiệu, 0..1. Cao = mục tiêu hấp dẫn hơn. */
  value: number;
  /** Mức tin cậy vào `value`, 0..1. 0 nghĩa là KHÔNG CÓ dữ liệu, khác hẳn value=0. */
  confidence: number;
  evidence: Record<string, unknown>;
}
