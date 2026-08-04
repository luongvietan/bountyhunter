import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { normalizeRepoUrl } from '@kritt-radar/core';
import type { MultiScopeRecord, ProgramAuditRecord, ScopeRecord } from './materialize.js';

const ManualProgramEntry = z.object({
  platform: z.string().min(1),
  externalId: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  poolUsd: z.number().finite().nonnegative().nullable().optional(),
  repos: z.array(z.string().min(1)).min(1),
  audits: z
    .array(
      z.object({
        auditId: z.string().min(1),
        firm: z.string().min(1),
        date: z.string().min(1),
        reportUrl: z.string().url().optional(),
      }),
    )
    .optional(),
});

const ManualProgramFile = z.record(z.string(), ManualProgramEntry);

function toDate(v: string): Date | null {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}

function toManualAudits(
  externalId: string,
  audits: z.infer<typeof ManualProgramEntry>['audits'],
): ProgramAuditRecord[] {
  const out: ProgramAuditRecord[] = [];
  for (const audit of audits ?? []) {
    const publishedAt = toDate(audit.date);
    if (!publishedAt) continue;
    out.push({
      auditId: audit.auditId,
      firm: audit.firm,
      publishedAt,
      reportUrl:
        audit.reportUrl ?? `https://immunefi.com/bounty/${externalId}/#audit-${audit.auditId}`,
      coveredCommit: null,
      coveredPaths: [],
    });
  }
  return out;
}

export function parseManualPrograms(yamlText: string): MultiScopeRecord[] {
  const parsed = ManualProgramFile.parse(parseYaml(yamlText) ?? {});
  const out: MultiScopeRecord[] = [];

  for (const entry of Object.values(parsed)) {
    const byRepo = new Map<string, ScopeRecord>();
    for (const rawRepo of entry.repos) {
      const repoKey = normalizeRepoUrl(rawRepo);
      if (!repoKey || byRepo.has(repoKey)) continue;
      byRepo.set(repoKey, {
        kind: 'repo',
        hardKey: repoKey,
        repoUrl: repoKey,
        pathGlobs: [],
        addedAt: null,
      });
    }
    if (byRepo.size === 0) continue;

    out.push({
      program: {
        platform: entry.platform,
        externalId: entry.externalId,
        title: entry.title,
        url: entry.url,
        poolUsd: entry.poolUsd ?? null,
        kind: 'bounty',
        publishedAt: null,
        startsAt: null,
        endsAt: null,
      },
      scopes: [...byRepo.values()],
      audits: toManualAudits(entry.externalId, entry.audits),
      changedAt: null,
    });
  }

  return out;
}

/** Gộp repo khai tay vào catalog Immunefi đã materialize từ mirror. */
export function mergeManualImmunefiPrograms(
  immunefi: readonly MultiScopeRecord[],
  manual: readonly MultiScopeRecord[],
): MultiScopeRecord[] {
  const byExternalId = new Map(immunefi.map((record) => [record.program.externalId, record]));

  for (const manualRecord of manual) {
    if (manualRecord.program.platform !== 'immunefi') {
      byExternalId.set(`${manualRecord.program.platform}:${manualRecord.program.externalId}`, manualRecord);
      continue;
    }

    const existing = byExternalId.get(manualRecord.program.externalId);
    if (!existing) {
      byExternalId.set(manualRecord.program.externalId, manualRecord);
      continue;
    }

    const repoKeys = new Set(existing.scopes.map((scope) => scope.hardKey));
    for (const scope of manualRecord.scopes) {
      if (repoKeys.has(scope.hardKey)) continue;
      existing.scopes.push(scope);
      repoKeys.add(scope.hardKey);
    }

    const auditIds = new Set(existing.audits.map((audit) => audit.auditId));
    for (const audit of manualRecord.audits) {
      if (auditIds.has(audit.auditId)) continue;
      existing.audits.push(audit);
      auditIds.add(audit.auditId);
    }

    if (!existing.program.poolUsd && manualRecord.program.poolUsd) {
      existing.program.poolUsd = manualRecord.program.poolUsd;
    }
  }

  return [...byExternalId.values()];
}
