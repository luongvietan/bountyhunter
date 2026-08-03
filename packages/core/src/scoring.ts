import { clamp01, type SignalType, type SignalValue } from './signals.js';

export interface Weights {
  version: string;
  /** Tín hiệu có confidence dưới ngưỡng này bị loại khỏi phép tính. */
  minConfidence: number;
  weights: Record<SignalType, number>;
}

export interface ScoreContribution {
  type: SignalType;
  value: number;
  confidence: number;
  /** Trọng số đã nhân confidence rồi chuẩn hoá lại, cộng tất cả bằng 1. */
  normalizedWeight: number;
  /** Số điểm tín hiệu này đóng góp vào tổng. */
  contribution: number;
}

export interface ScoreResult {
  total: number;
  breakdown: ScoreContribution[];
  usedSignals: number;
  skipped: SignalType[];
  weightsVersion: string;
}

/**
 * Tổng có trọng số, thang 0..100.
 *
 * Tín hiệu thiếu dữ liệu (confidence thấp) bị LOẠI và trọng số được chuẩn hoá
 * lại trên phần còn lại — chứ không bị tính như value=0. Nếu tính như 0, một
 * target chỉ vì thiếu dữ liệu sẽ tụt hạng y như một target thật sự kém, và
 * bảng xếp hạng sẽ ưu ái những target dễ crawl thay vì những target đáng làm.
 *
 * Confidence không chỉ là cổng chặn mà còn nhân thẳng vào trọng số. Nếu chỉ
 * chặn, một phỏng đoán 1.0 ở confidence 0.35 đóng góp y hệt một phép đo 1.0 ở
 * confidence 0.7, và những target ta biết ít nhất lại leo lên đầu bảng bằng
 * chính sự thiếu hiểu biết đó. Nhân vào trọng số rồi chuẩn hoá lại giữ nguyên
 * hành vi ở hai đầu mút — confidence 0 vẫn bị loại, các tín hiệu cùng độ tin cậy
 * vẫn chia đều — nhưng liên tục ở khoảng giữa.
 */
export function score(signals: readonly SignalValue[], weights: Weights): ScoreResult {
  const used: SignalValue[] = [];
  const skipped: SignalType[] = [];

  for (const s of signals) {
    const w = weights.weights[s.type] ?? 0;
    if (w > 0 && s.confidence >= weights.minConfidence) used.push(s);
    else skipped.push(s.type);
  }

  const effectiveWeight = (s: SignalValue): number =>
    (weights.weights[s.type] ?? 0) * clamp01(s.confidence);

  const totalWeight = used.reduce((acc, s) => acc + effectiveWeight(s), 0);

  if (totalWeight <= 0) {
    return { total: 0, breakdown: [], usedSignals: 0, skipped, weightsVersion: weights.version };
  }

  const breakdown: ScoreContribution[] = used.map((s) => {
    const normalizedWeight = effectiveWeight(s) / totalWeight;
    return {
      type: s.type,
      value: s.value,
      confidence: s.confidence,
      normalizedWeight,
      contribution: clamp01(s.value) * normalizedWeight * 100,
    };
  });

  const total = breakdown.reduce((acc, b) => acc + b.contribution, 0);

  return { total, breakdown, usedSignals: used.length, skipped, weightsVersion: weights.version };
}
