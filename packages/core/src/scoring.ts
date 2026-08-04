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
  /**
   * Phần trọng số cấu hình thực sự đo được, 0..1. Điểm 40 với coverage 1.0 nói
   * lên điều khác hẳn điểm 40 với coverage 0.33.
   */
  coverage: number;
  skipped: SignalType[];
  weightsVersion: string;
}

/**
 * Tổng có trọng số, thang 0..100.
 *
 * Điểm đo hai thứ cùng lúc: ta biết GÌ, và ta biết được BAO NHIÊU. Mẫu số là
 * tổng trọng số cấu hình, không phải tổng trọng số đo được, nên một target chỉ
 * có một tín hiệu không thể đạt trần.
 *
 * Bản trước chuẩn hoá lại trên các tín hiệu dùng được, và ở quy mô thật điều đó
 * hoá ra sai: 1425 scope chỉ có một tín hiệu, và một trong số đó đạt 100 điểm
 * chỉ nhờ `value_at_risk`, đứng trên một target được đo bằng cả ba tín hiệu.
 * Chuẩn hoá lại đã thổi phồng thông tin bộ phận lên thang đầy đủ.
 *
 * Confidence nhân thẳng vào trọng số, nên nó vừa hạ đóng góp vừa hạ độ phủ:
 * ba phép đo yếu xếp dưới ba phép đo chắc. Bất biến cũ vẫn còn: tín hiệu
 * confidence 0 đóng góp 0 vào tử số và không đụng mẫu số, nên thêm nó vào không
 * làm đổi điểm.
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

  // Trọng số 0 nghĩa là tín hiệu đó không được tính vào thang điểm — dùng cho
  // tín hiệu chưa cài đặt, để nó không âm thầm chặn trần mọi target.
  const configuredWeight = Object.values(weights.weights).reduce(
    (acc, w) => acc + (w > 0 ? w : 0),
    0,
  );
  const usedWeight = used.reduce((acc, s) => acc + effectiveWeight(s), 0);

  if (configuredWeight <= 0 || usedWeight <= 0) {
    return {
      total: 0,
      breakdown: [],
      usedSignals: 0,
      coverage: 0,
      skipped,
      weightsVersion: weights.version,
    };
  }

  const breakdown: ScoreContribution[] = used.map((s) => {
    const normalizedWeight = effectiveWeight(s) / configuredWeight;
    return {
      type: s.type,
      value: s.value,
      confidence: s.confidence,
      normalizedWeight,
      contribution: clamp01(s.value) * normalizedWeight * 100,
    };
  });

  // Một phép chia thay vì cộng dồn từng đóng góp: cộng ba lần một phần ba cho
  // 99.99999999999999, và điểm tròn nên tròn thật.
  const weightedValue = used.reduce(
    (acc, s) => acc + clamp01(s.value) * effectiveWeight(s),
    0,
  );
  const total = (weightedValue / configuredWeight) * 100;

  return {
    total,
    breakdown,
    usedSignals: used.length,
    coverage: usedWeight / configuredWeight,
    skipped,
    weightsVersion: weights.version,
  };
}
