import { score, type ScoreResult, type SignalType, type SignalValue, type Weights } from '@kritt-radar/core';
import type { PrismaClient, Program, Scope, Signal } from '@kritt-radar/db';

export interface TargetSignal {
  type: SignalType;
  value: number;
  confidence: number;
  evidence: Record<string, unknown>;
  computedAt: string;
}

export interface TargetProgram {
  scopeId: string;
  title: string;
  platform: string;
  url: string;
  poolUsd: number | null;
}

export interface RankedTarget {
  scopeId: string;
  repoKey: string;
  programTitle: string;
  programUrl: string;
  platform: string;
  poolUsd: number | null;
  endsAt: string | null;
  /**
   * Every program whose scope covers this repository, best-paying first.
   *
   * The operator scans a repository once; which program to submit to is a
   * separate decision. Seventeen repositories appear under two or three
   * programs, and they cluster at the top of the ranking, so listing one row
   * per program would fill the working set with duplicate code.
   */
  programs: TargetProgram[];
  /** HEAD the last snapshot observed, so a scope can be handed over pinned. */
  commitish: string | null;
  score: ScoreResult;
  signals: TargetSignal[];
  /** Files changed since the last audit: the payload an operator hands to Open-Kritt. */
  scopeFiles: string[];
  /** Why audit_gap is what it is, when it is not a measurement. */
  auditGapReason: string | null;
}

export interface RankingFilters {
  platform: string | null;
  /** Hide targets whose audit gap is assumed rather than measured. */
  measuredOnly: boolean;
}

export interface TargetRankingPage {
  targets: RankedTarget[];
  platforms: string[];
  filters: RankingFilters;
  totals: { all: number; measured: number; shown: number };
  weightsVersion: string;
}

type ScopeWithEvidence = Scope & { program: Program; signals: Signal[] };

function evidenceOf(signal: Signal): Record<string, unknown> {
  return typeof signal.evidence === 'object' && signal.evidence !== null && !Array.isArray(signal.evidence)
    ? (signal.evidence as Record<string, unknown>)
    : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * A measured audit gap is one computed from a real audit cutoff. Anything
 * carrying a `reason` is the extractor explaining why it could not measure, and
 * an operator deciding where to spend scan tokens needs that separated out.
 */
export function isMeasuredAuditGap(signals: readonly TargetSignal[]): boolean {
  const gap = signals.find((signal) => signal.type === 'audit_gap');
  return gap !== undefined && gap.confidence > 0 && typeof gap.evidence.reason !== 'string';
}

const NON_CODE_DIRS = ['.github/', '.claude/', '.vscode/', 'docs/', 'doc/', 'licenses/'];
/** Matched against the basename as-is; dotfiles have no extension to strip. */
const NON_CODE_NAMES =
  /^(license|licence|notice|readme|changelog|codeowners|\.git[a-z]*|\.env(\..+)?|\.npmrc|\.nvmrc|\.editorconfig|\.prettierrc.*|\.eslintrc.*)$/i;
const NON_CODE_EXTENSIONS = /\.(md|mdx|txt|rst|png|jpe?g|gif|svg|ico|webp|pdf|lock|csv)$/i;

/**
 * Split a changed-file list into what a scan should read and what it should not.
 *
 * Open-Kritt bills per file, so handing it CI workflows, licences and images is
 * money spent on files that cannot hold a vulnerability. Nothing is dropped
 * silently: both halves are returned so the operator sees what was set aside and
 * can still take the full list.
 */
export function partitionScopeFiles(files: readonly string[]): { code: string[]; other: string[] } {
  const code: string[] = [];
  const other: string[] = [];

  for (const file of files) {
    const lower = file.toLowerCase();
    const basename = lower.slice(lower.lastIndexOf('/') + 1);
    const isOther =
      NON_CODE_DIRS.some((dir) => lower.startsWith(dir) || lower.includes(`/${dir}`)) ||
      NON_CODE_NAMES.test(basename) ||
      NON_CODE_EXTENSIONS.test(basename);
    (isOther ? other : code).push(file);
  }

  return { code, other };
}

export function parsePlatform(value: string | string[] | undefined, allowed: readonly string[]): string | null {
  return typeof value === 'string' && allowed.includes(value) ? value : null;
}

export function parseMeasuredOnly(value: string | string[] | undefined): boolean {
  return value === '1' || value === 'true';
}

function toTarget(scope: ScopeWithEvidence, weights: Weights): RankedTarget {
  const signals: TargetSignal[] = scope.signals.map((signal) => ({
    type: signal.type as SignalType,
    value: signal.value,
    confidence: signal.confidence,
    evidence: evidenceOf(signal),
    computedAt: signal.computedAt.toISOString(),
  }));

  const scoreInput: SignalValue[] = signals.map(({ type, value, confidence, evidence }) => ({
    type,
    value,
    confidence,
    evidence,
  }));

  const gap = signals.find((signal) => signal.type === 'audit_gap');
  const reason = gap && typeof gap.evidence.reason === 'string' ? gap.evidence.reason : null;

  return {
    scopeId: scope.id,
    repoKey: scope.hardKey ?? scope.repoUrl ?? scope.id,
    programTitle: scope.program.title,
    programUrl: scope.program.url,
    platform: scope.program.platform,
    poolUsd: scope.program.poolUsd === null ? null : Number(scope.program.poolUsd),
    endsAt: scope.program.endsAt?.toISOString() ?? null,
    programs: [
      {
        scopeId: scope.id,
        title: scope.program.title,
        platform: scope.program.platform,
        url: scope.program.url,
        poolUsd: scope.program.poolUsd === null ? null : Number(scope.program.poolUsd),
      },
    ],
    commitish: scope.commitish,
    score: score(scoreInput, weights),
    signals,
    scopeFiles: gap ? stringList(gap.evidence.files) : [],
    auditGapReason: reason,
  };
}

/**
 * Collapse the per-program scopes of one repository into a single row.
 *
 * Keeps the highest-scoring scope as the representative, since audit gap is a
 * property of the code and barely differs between programs, and carries the
 * paying programs alongside it ordered by pool.
 */
export function groupByRepo(targets: readonly RankedTarget[]): RankedTarget[] {
  const byRepo = new Map<string, RankedTarget>();

  for (const target of targets) {
    const existing = byRepo.get(target.repoKey);
    if (!existing) {
      byRepo.set(target.repoKey, { ...target, programs: [...target.programs] });
      continue;
    }

    const programs = [...existing.programs, ...target.programs];
    const winner = target.score.total > existing.score.total ? target : existing;
    byRepo.set(target.repoKey, {
      ...winner,
      programs: programs.sort((left, right) => (right.poolUsd ?? -1) - (left.poolUsd ?? -1)),
    });
  }

  // Surface the best-paying program on the row, which is the one worth naming.
  for (const [key, target] of byRepo) {
    const best = target.programs[0];
    if (!best) continue;
    byRepo.set(key, {
      ...target,
      programTitle: best.title,
      programUrl: best.url,
      platform: best.platform,
      poolUsd: best.poolUsd,
    });
  }

  return [...byRepo.values()];
}

/**
 * Scoring happens here rather than in SQL so a weights change re-ranks the
 * stored signals immediately, with no collection or materialization run.
 */
export async function listRankedTargets(
  prisma: PrismaClient,
  weights: Weights,
  raw: { platform?: string | string[]; measured?: string | string[] },
): Promise<TargetRankingPage> {
  const scopes = (await prisma.scope.findMany({
    where: { kind: 'repo' },
    include: { program: true, signals: true },
    orderBy: { id: 'asc' },
  })) as ScopeWithEvidence[];

  const all = groupByRepo(scopes.map((scope) => toTarget(scope, weights)));
  const platforms = [...new Set(all.flatMap((t) => t.programs.map((p) => p.platform)))].sort();

  const filters: RankingFilters = {
    platform: parsePlatform(raw.platform, platforms),
    measuredOnly: parseMeasuredOnly(raw.measured),
  };

  const shown = all
    // Match on any covering program, not just the one named on the row.
    .filter((target) =>
      filters.platform ? target.programs.some((p) => p.platform === filters.platform) : true,
    )
    .filter((target) => (filters.measuredOnly ? isMeasuredAuditGap(target.signals) : true))
    // Ties broken by repo key so a refresh never reshuffles equal scores.
    .sort((left, right) => right.score.total - left.score.total || left.repoKey.localeCompare(right.repoKey));

  return {
    targets: shown,
    platforms,
    filters,
    totals: {
      all: all.length,
      measured: all.filter((target) => isMeasuredAuditGap(target.signals)).length,
      shown: shown.length,
    },
    weightsVersion: weights.version,
  };
}

export async function findTarget(
  prisma: PrismaClient,
  weights: Weights,
  scopeId: string,
): Promise<RankedTarget | null> {
  const scope = (await prisma.scope.findUnique({
    where: { id: scopeId },
    include: { program: true, signals: true },
  })) as ScopeWithEvidence | null;

  return scope ? toTarget(scope, weights) : null;
}
