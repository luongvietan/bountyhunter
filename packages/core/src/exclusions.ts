import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const OwnerRule = z.object({
  owner: z.string().min(1),
  reason: z.string().min(1),
});

const ExclusionsSchema = z.object({
  owners: z.array(OwnerRule).default([]),
});

export interface ExclusionRule {
  owner: string;
  reason: string;
}

export interface Exclusions {
  /** Keyed by lowercase owner, so lookup is exact rather than a substring match. */
  byOwner: Map<string, ExclusionRule>;
}

export function parseExclusions(yamlText: string): Exclusions {
  const parsed = ExclusionsSchema.parse(parseYaml(yamlText) ?? {});
  const byOwner = new Map<string, ExclusionRule>();
  for (const rule of parsed.owners) {
    byOwner.set(rule.owner.trim().toLowerCase(), rule);
  }
  return { byOwner };
}

/** `github.com/owner/repo` -> `owner`. Null when the key is not a repo key. */
export function repoOwner(hardKey: string | null | undefined): string | null {
  if (!hardKey) return null;
  const parts = hardKey.toLowerCase().split('/');
  return parts.length >= 3 && parts[1] ? parts[1] : null;
}

export interface ExclusionInput {
  hardKey: string | null;
  /** null means the program has no end date, which is normal for a live bounty. */
  endsAt: Date | null;
}

export type ExclusionReason = 'closed_program' | 'excluded_owner';

export interface ExclusionVerdict {
  excluded: boolean;
  reason: ExclusionReason | null;
  detail: string | null;
}

/**
 * Why a scope should not appear as a target.
 *
 * Kept separate from deletion: a closed contest is still audit evidence, and a
 * mirror repository still tells us the upstream was reviewed. The rows stay in
 * the database and drop out of the ranking, and the counts are reported so the
 * list never shrinks silently.
 */
export function exclusionFor(
  input: ExclusionInput,
  exclusions: Exclusions,
  now: Date,
): ExclusionVerdict {
  if (input.endsAt !== null && input.endsAt.getTime() < now.getTime()) {
    return {
      excluded: true,
      reason: 'closed_program',
      detail: `Program closed ${input.endsAt.toISOString().slice(0, 10)}`,
    };
  }

  const owner = repoOwner(input.hardKey);
  const rule = owner ? exclusions.byOwner.get(owner) : undefined;
  if (rule) {
    return { excluded: true, reason: 'excluded_owner', detail: rule.reason };
  }

  return { excluded: false, reason: null, detail: null };
}
