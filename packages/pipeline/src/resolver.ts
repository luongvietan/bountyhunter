import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { normalizeRepoUrl } from '@kritt-radar/core';

const MatchRule = z.union([
  z.object({ repo: z.string() }),
  z.object({ platformName: z.object({ platform: z.string(), name: z.string() }) }),
  z.object({ auditHint: z.string() }),
  z.object({ defillama: z.string() }),
]);

const AliasEntry = z.object({
  canonicalName: z.string().min(1),
  match: z.array(MatchRule).min(1),
});

const AliasFile = z.record(z.string(), AliasEntry);

export type AliasTable = {
  byRepoKey: Map<string, { slug: string; canonicalName: string }>;
  byPlatformName: Map<string, { slug: string; canonicalName: string }>;
  byAuditHint: Map<string, { slug: string; canonicalName: string }>;
  byDefillama: Map<string, { slug: string; canonicalName: string }>;
};

function platformNameKey(platform: string, name: string): string {
  return `${platform.trim().toLowerCase()} ${name.trim()}`;
}

export function parseAliases(yamlText: string): AliasTable {
  const parsed = AliasFile.parse(parseYaml(yamlText) ?? {});
  const byRepoKey = new Map<string, { slug: string; canonicalName: string }>();
  const byPlatformName = new Map<string, { slug: string; canonicalName: string }>();
  const byAuditHint = new Map<string, { slug: string; canonicalName: string }>();
  const byDefillama = new Map<string, { slug: string; canonicalName: string }>();

  for (const [slug, entry] of Object.entries(parsed)) {
    const target = { slug, canonicalName: entry.canonicalName };
    for (const rule of entry.match) {
      if ('repo' in rule) {
        const key = normalizeRepoUrl(rule.repo);
        if (key) byRepoKey.set(key, target);
      } else if ('platformName' in rule) {
        byPlatformName.set(
          platformNameKey(rule.platformName.platform, rule.platformName.name),
          target,
        );
      } else if ('auditHint' in rule) {
        byAuditHint.set(rule.auditHint.trim().toLowerCase(), target);
      } else {
        byDefillama.set(rule.defillama.trim().toLowerCase(), target);
      }
    }
  }
  return { byRepoKey, byPlatformName, byAuditHint, byDefillama };
}

export interface ResolveInput {
  repoUrl?: string | undefined;
  platform?: string | undefined;
  title?: string | undefined;
}

export interface ResolvedEntity {
  slug: string;
  canonicalName: string;
  /** 1 = khoá cứng (repo/address), 2 = alias khai tay. Không có tầng 3 ở pha này. */
  tier: 1 | 2;
}

/**
 * Chỉ khớp CHÍNH XÁC. Không fuzzy, không so gần đúng.
 *
 * Merge sai không ném exception — nó chỉ trộn tín hiệu của hai dự án khác nhau
 * và làm bảng xếp hạng sai âm thầm suốt nhiều tuần. Thà trả null rồi để một
 * dòng trong aliases.yml sửa, còn hơn đoán.
 */
export function resolveEntityKey(input: ResolveInput, aliases: AliasTable): ResolvedEntity | null {
  if (input.repoUrl) {
    const key = normalizeRepoUrl(input.repoUrl);
    if (key) {
      const hit = aliases.byRepoKey.get(key);
      if (hit) return { ...hit, tier: 1 };
    }
  }

  if (input.platform && input.title) {
    const hit = aliases.byPlatformName.get(platformNameKey(input.platform, input.title));
    if (hit) return { ...hit, tier: 2 };
  }

  return null;
}
