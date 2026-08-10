import { repoOwner, type Exclusions } from '@kritt-radar/core';
import type { PrismaClient } from '@kritt-radar/db';
import { decideMergeCandidate, type MergeDecisionActor } from './merge-decisions.js';
import { llmConfigured, reviewMergeCandidate } from './llm-client.js';

export interface AutoMergeConfig {
  enabled: boolean;
  autoMin: number;
  aiMin: number;
  aiConfidenceMin: number;
  dryRun: boolean;
}

export interface AutoMergeResult {
  pending: number;
  autoApproved: number;
  aiApproved: number;
  skippedConflict: number;
  skippedLow: number;
  skippedAi: number;
  errors: number;
}

function readConfig(): AutoMergeConfig {
  return {
    enabled: process.env.RADAR_AUTO_MERGE !== 'false',
    autoMin: Number(process.env.RADAR_AUTO_MERGE_MIN ?? 0.92),
    aiMin: Number(process.env.RADAR_AUTO_MERGE_AI_MIN ?? 0.85),
    aiConfidenceMin: Number(process.env.RADAR_AUTO_MERGE_AI_CONFIDENCE ?? 0.85),
    dryRun: process.env.RADAR_AUTOMATE_DRY_RUN === 'true',
  };
}

function scopeKeys(
  programs: Array<{ scopes: Array<{ hardKey: string | null }> }>,
): Set<string> {
  const keys = new Set<string>();
  for (const program of programs) {
    for (const scope of program.scopes) {
      if (scope.hardKey) keys.add(scope.hardKey.toLowerCase());
    }
  }
  return keys;
}

function hasHardKeyConflict(
  leftKeys: Set<string>,
  rightKeys: Set<string>,
  sharedAliasKeys: Set<string>,
): boolean {
  if (leftKeys.size === 0 || rightKeys.size === 0) return false;
  if (sharedAliasKeys.size > 0) return false;
  for (const key of leftKeys) {
    if (rightKeys.has(key)) return false;
  }
  return true;
}

function hasExcludedOwner(
  keys: Set<string>,
  exclusions: Exclusions,
): boolean {
  for (const key of keys) {
    const owner = repoOwner(key);
    if (owner && exclusions.byOwner.has(owner)) return true;
  }
  return false;
}

export async function runAutoMerge(
  prisma: PrismaClient,
  exclusions: Exclusions,
  config: AutoMergeConfig = readConfig(),
): Promise<AutoMergeResult> {
  const result: AutoMergeResult = {
    pending: 0,
    autoApproved: 0,
    aiApproved: 0,
    skippedConflict: 0,
    skippedLow: 0,
    skippedAi: 0,
    errors: 0,
  };

  if (!config.enabled) return result;

  const candidates = await prisma.mergeCandidate.findMany({
    where: { status: 'pending' },
    orderBy: [{ similarity: 'desc' }, { createdAt: 'asc' }],
    include: {
      leftEntity: {
        include: {
          auditReports: { select: { projectHint: true } },
          programs: { include: { scopes: { select: { hardKey: true } } } },
          aliases: { where: { kind: 'audit_hint' }, select: { key: true } },
        },
      },
      rightEntity: {
        include: {
          auditReports: { select: { projectHint: true } },
          programs: { include: { scopes: { select: { hardKey: true } } } },
          aliases: { where: { kind: 'audit_hint' }, select: { key: true } },
        },
      },
    },
  });

  result.pending = candidates.length;

  for (const candidate of candidates) {
    const left = candidate.leftEntity;
    const right = candidate.rightEntity;
    const leftIsProvisional = left.programs.length === 0;
    const rightIsProvisional = right.programs.length === 0;
    if (leftIsProvisional === rightIsProvisional) continue;

    const provisional = leftIsProvisional ? left : right;
    const canonical = leftIsProvisional ? right : left;
    const leftKeys = scopeKeys(left.programs);
    const rightKeys = scopeKeys(right.programs);
    const aliasKeys = new Set([
      ...left.aliases.map((a) => a.key),
      ...right.aliases.map((a) => a.key),
    ]);

    if (
      hasHardKeyConflict(leftKeys, rightKeys, aliasKeys) ||
      hasExcludedOwner(leftKeys, exclusions) ||
      hasExcludedOwner(rightKeys, exclusions)
    ) {
      result.skippedConflict += 1;
      continue;
    }

    let actor: MergeDecisionActor | null = null;
    let note = '';

    if (candidate.similarity >= config.autoMin) {
      actor = 'auto';
      note = `Auto-approved at ${(candidate.similarity * 100).toFixed(0)}% similarity.`;
    } else if (candidate.similarity >= config.aiMin && llmConfigured()) {
      try {
        const verdict = await reviewMergeCandidate({
          leftName: provisional.canonicalName,
          leftSlug: provisional.slug,
          rightName: canonical.canonicalName,
          rightSlug: canonical.slug,
          similarity: candidate.similarity,
          leftHints: provisional.auditReports.map((r) => r.projectHint),
          rightPrograms: canonical.programs.map((p) => p.title),
          leftRepoScopes: [...scopeKeys(provisional.programs)],
          rightRepoScopes: [...scopeKeys(canonical.programs)],
        });
        if (
          verdict?.decision === 'approve' &&
          verdict.confidence >= config.aiConfidenceMin
        ) {
          actor = 'ai';
          note = verdict.reason.slice(0, 500);
        } else {
          result.skippedAi += 1;
          continue;
        }
      } catch {
        result.errors += 1;
        continue;
      }
    } else {
      result.skippedLow += 1;
      continue;
    }

    if (config.dryRun) {
      console.log(
        `[auto-merge] dry-run would approve ${candidate.id} (${actor}): ${note}`,
      );
      if (actor === 'auto') result.autoApproved += 1;
      else result.aiApproved += 1;
      continue;
    }

    const decision = await decideMergeCandidate(prisma, {
      candidateId: candidate.id,
      action: 'approve',
      decidedBy: actor,
      decisionNote: note,
    });

    if (!decision.ok) {
      if (decision.code === 'conflict') continue;
      result.errors += 1;
      continue;
    }

    if (actor === 'auto') result.autoApproved += 1;
    else result.aiApproved += 1;
  }

  return result;
}

export function formatAutoMerge(result: AutoMergeResult): string {
  return (
    `[auto-merge] pending=${result.pending} auto=${result.autoApproved} ai=${result.aiApproved} ` +
    `conflict=${result.skippedConflict} low=${result.skippedLow} ai-skip=${result.skippedAi} ` +
    `errors=${result.errors}`
  );
}
