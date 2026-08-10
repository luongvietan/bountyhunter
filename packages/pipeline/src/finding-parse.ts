import { z } from 'zod';

const NumericString = z.union([z.number(), z.string()]).nullish();

/**
 * One post-script's output for one finding. Kritt reserves `_reserved_report`
 * and `_reserved_poc`; everything else is whatever the script declared.
 */
const Enrichment = z
  .object({
    postScriptName: z.string().nullish(),
    result: z.record(z.unknown()).nullish(),
    stub: z.boolean().nullish(),
  })
  .passthrough();

const RawFinding = z
  .object({
    id: z.union([z.number(), z.string()]),
    postScriptAnswer: z.record(z.unknown()).nullish(),
    enrichments: z.array(Enrichment).nullish(),
    rank: z.number().nullish(),
    summary: z.string().nullish(),
    explanation: z.string().nullish(),
    file_path: z.string().nullish(),
    line: z.union([z.number(), z.string()]).nullish(),
    malicious_input_example: z.string().nullish(),
    malicious_actor: z.string().nullish(),
    trigger_flow: z.array(z.unknown()).nullish(),
    vulnerability_type: z.string().nullish(),
    exploitable: z.unknown().nullish(),
    severity: z.string().nullish(),
    dedupe: z
      .object({ isCanonical: z.boolean().nullish(), clusterId: z.string().nullish() })
      .nullish(),
    bountyRank: z
      .object({
        rank: z.number().nullish(),
        impactLevel: z.string().nullish(),
        minimumReward: NumericString,
        maximumReward: NumericString,
        reasoning: z.string().nullish(),
      })
      .nullish(),
  })
  .passthrough();

export interface ParsedFinding {
  krittVulnId: string;
  rank: number | null;
  title: string;
  vulnerabilityType: string | null;
  filePath: string | null;
  line: number | null;
  severity: string | null;
  /** null when the workflow did not judge exploitability either way. */
  exploitable: boolean | null;
  explanation: string | null;
  maliciousInput: string | null;
  maliciousActor: string | null;
  triggerFlow: string[];
  bountyRank: number | null;
  impactLevel: string | null;
  minRewardUsd: number | null;
  maxRewardUsd: number | null;
  rankReasoning: string | null;
  clusterId: string | null;
  /** Markdown write-up from the Report Creator post-script. */
  krittReport: string | null;
  /** The PoC Creator's diff, the thing a program actually asks for. */
  pocDiff: string | null;
  /** The scope post-script's verdict; null when it did not run or did not answer. */
  inScope: boolean | null;
  /** The scope post-script's re-validation of the finding itself. */
  postScriptValid: boolean | null;
  /** Verdict from the Finding Triage post-script: review | noise | invalid. */
  triageVerdict: string | null;
  triageReason: string | null;
  raw: unknown;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (['true', 'yes', 'confirmed'].includes(lower)) return true;
    if (['false', 'no'].includes(lower)) return false;
  }
  return null;
}

type EnrichmentResult = Record<string, unknown>;

/**
 * Flatten every post-script result for one finding into a single lookup. Later
 * scripts in the chain win: the chain runs proof first, so a script that reruns
 * a key downstream saw more than the one before it.
 */
function mergeEnrichments(
  enrichments: readonly z.infer<typeof Enrichment>[] | null | undefined,
  postScriptAnswer: EnrichmentResult | null | undefined,
): EnrichmentResult {
  const merged: EnrichmentResult = { ...(postScriptAnswer ?? {}) };
  for (const entry of enrichments ?? []) {
    // A stub is the post-script reporting it had nothing to say; its keys are
    // placeholders and would overwrite a real answer from an earlier script.
    if (entry.stub === true || !entry.result) continue;
    Object.assign(merged, entry.result);
  }
  return merged;
}

function toMarkdown(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function toVerdict(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function toReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Read the Finding Triage post-script verdict from merged enrichment output.
 */
function readTriageVerdict(
  enrichments: readonly z.infer<typeof Enrichment>[] | null | undefined,
  post: EnrichmentResult,
): string | null {
  const fromPost =
    toVerdict(post.triage_verdict) ??
    toVerdict(post._chip_triage_verdict) ??
    toVerdict(post.verdict);
  if (fromPost) return fromPost;

  for (const entry of enrichments ?? []) {
    if (entry.postScriptName !== 'Finding Triage' || entry.stub === true || !entry.result) continue;
    const result = entry.result;
    const verdict =
      toVerdict(result.triage_verdict) ??
      toVerdict(result._chip_triage_verdict) ??
      toVerdict(result.verdict);
    if (verdict) return verdict;
  }

  return null;
}

function readTriageReason(
  enrichments: readonly z.infer<typeof Enrichment>[] | null | undefined,
  post: EnrichmentResult,
): string | null {
  const fromPost = toReason(post.triage_reason);
  if (fromPost) return fromPost;

  for (const entry of enrichments ?? []) {
    if (entry.postScriptName !== 'Finding Triage' || entry.stub === true || !entry.result) continue;
    const reason = toReason((entry.result as EnrichmentResult).triage_reason);
    if (reason) return reason;
  }

  return null;
}

/**
 * Kritt already dedupes and ranks by expected bounty, so this reads its verdict
 * rather than recomputing one. Duplicates are dropped here as well as by the
 * endpoint's default, because a caller that asked for them explicitly should
 * still not have them land in the review queue twice.
 */
export function parseFindings(raw: unknown): ParsedFinding[] {
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null && Array.isArray((raw as { items?: unknown[] }).items)
      ? (raw as { items: unknown[] }).items
      : [];

  const out: ParsedFinding[] = [];

  for (const item of items) {
    const parsed = RawFinding.safeParse(item);
    if (!parsed.success) continue;
    const f = parsed.data;
    if (f.dedupe?.isCanonical === false) continue;

    // A finding with no summary and no explanation carries nothing a human
    // could review or submit, so it is not worth a row.
    const title = (f.summary ?? f.explanation ?? '').trim();
    if (title.length === 0) continue;

    const post = mergeEnrichments(f.enrichments, f.postScriptAnswer);

    out.push({
      krittVulnId: String(f.id),
      rank: f.rank ?? null,
      title: title.length > 300 ? `${title.slice(0, 297)}...` : title,
      vulnerabilityType: f.vulnerability_type ?? null,
      filePath: f.file_path ?? null,
      line: toNumber(f.line),
      severity: f.severity ?? null,
      exploitable: toBoolean(f.exploitable),
      explanation: f.explanation ?? null,
      maliciousInput: f.malicious_input_example ?? null,
      maliciousActor: f.malicious_actor ?? null,
      triggerFlow: (f.trigger_flow ?? [])
        .map((step) => (typeof step === 'string' ? step : JSON.stringify(step)))
        .filter((step): step is string => typeof step === 'string' && step.length > 0),
      bountyRank: f.bountyRank?.rank ?? null,
      impactLevel: f.bountyRank?.impactLevel ?? null,
      minRewardUsd: toNumber(f.bountyRank?.minimumReward),
      maxRewardUsd: toNumber(f.bountyRank?.maximumReward),
      rankReasoning: f.bountyRank?.reasoning ?? null,
      clusterId: f.dedupe?.clusterId ?? null,
      krittReport: toMarkdown(post._reserved_report),
      pocDiff: toMarkdown(post._reserved_poc),
      inScope: toBoolean(post._chip_is_in_scope),
      postScriptValid: toBoolean(post.is_valid),
      triageVerdict: readTriageVerdict(f.enrichments, post),
      triageReason: readTriageReason(f.enrichments, post),
      raw: item,
    });
  }

  // Kritt orders by rank ascending, where 1 is best. Null ranks go last rather
  // than sorting as zero and jumping the queue.
  return out.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
}

/**
 * A finding is worth a human's attention when the workflow could not rule out
 * exploitation. Explicit `exploitable: false` is the one clear signal that the
 * agent checked and found it not reachable.
 */
export function isReviewable(finding: ParsedFinding): boolean {
  return finding.exploitable !== false;
}
