export type AliasKind = 'repo' | 'platform_name' | 'audit_hint' | 'defillama';

export interface EntitySeed {
  slug: string;
  canonicalName: string;
}

export interface CandidateScore {
  similarity: number;
  reason: {
    tokenJaccard: number;
    editSimilarity: number;
  };
}

const NOISE_TOKENS = new Set(['audit', 'report', 'security', 'assessment', 'review']);

function identityTokens(value: string): string[] {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0 && !NOISE_TOKENS.has(token));
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function levenshteinDistance(left: string, right: string): number {
  if (left.length > right.length) return levenshteinDistance(right, left);

  let previous = Array.from({ length: left.length + 1 }, (_, index) => index);
  let current = new Array<number>(left.length + 1);

  for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
    current[0] = rightIndex;
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      current[leftIndex] = Math.min(
        current[leftIndex - 1]! + 1,
        previous[leftIndex]! + 1,
        previous[leftIndex - 1]! + Number(left[leftIndex - 1] !== right[rightIndex - 1]),
      );
    }
    [previous, current] = [current, previous];
  }

  return previous[left.length]!;
}

export function normalizeIdentityText(value: string): string {
  return identityTokens(value).join(' ');
}

export function repoEntitySeed(repoKey: string): EntitySeed {
  const normalizedKey = repoKey.trim().toLowerCase();
  const [, owner, repository] = normalizedKey.split('/');

  return {
    slug: `repo-${slugify(normalizedKey)}`,
    canonicalName: owner && repository ? `${owner}/${repository}` : normalizedKey,
  };
}

export function auditEntitySeed(projectHint: string): EntitySeed {
  const canonicalName = normalizeIdentityText(projectHint);

  return {
    slug: `audit-${slugify(canonicalName)}`,
    canonicalName,
  };
}

export function scoreCandidate(left: string, right: string): CandidateScore {
  const normalizedLeft = normalizeIdentityText(left);
  const normalizedRight = normalizeIdentityText(right);
  const leftTokens = new Set(normalizedLeft.split(' ').filter(Boolean));
  const rightTokens = new Set(normalizedRight.split(' ').filter(Boolean));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const tokenJaccard = clamp(union === 0 ? 1 : intersection / union);
  const longestLength = Math.max(normalizedLeft.length, normalizedRight.length);
  const editSimilarity = clamp(
    longestLength === 0 ? 1 : 1 - levenshteinDistance(normalizedLeft, normalizedRight) / longestLength,
  );

  return {
    similarity: clamp(0.6 * tokenJaccard + 0.4 * editSimilarity),
    reason: { tokenJaccard, editSimilarity },
  };
}
