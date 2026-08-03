import { z } from 'zod';
import { fetchJson } from '../http.js';
import { makeObservation, type Collector, type FetchCtx, type RawObservation } from '../types.js';

/** Các hãng audit công bố report dạng file trong repo GitHub công khai. */
export const AUDIT_REPO_SOURCES = [
  { firm: 'trailofbits', repoKey: 'github.com/trailofbits/publications' },
  { firm: 'openzeppelin', repoKey: 'github.com/OpenZeppelin/openzeppelin-contracts' },
  { firm: 'spearbit', repoKey: 'github.com/spearbit/portfolio' },
  { firm: 'zellic', repoKey: 'github.com/Zellic/publications' },
] as const;

const Tree = z.object({
  tree: z.array(z.object({ path: z.string(), type: z.string() })),
});

export interface AuditReportPayload {
  firm: string;
  projectHint: string;
  publishedAt: string;
  reportUrl: string;
}

/** `reports/2026-04-uniswap-v4.pdf` -> ngày 2026-04-01, hint "uniswap-v4". */
const REPORT_NAME = /(\d{4})-(\d{2})(?:-(\d{2}))?-(.+)\.(pdf|md)$/i;

export function parseAuditTree(raw: unknown, firm: string, repoKey: string): AuditReportPayload[] {
  const parsed = Tree.safeParse(raw);
  if (!parsed.success) return [];
  const out: AuditReportPayload[] = [];

  for (const node of parsed.data.tree) {
    if (node.type !== 'blob') continue;
    const base = node.path.split('/').pop() ?? '';
    const m = REPORT_NAME.exec(base);
    if (!m) continue;

    const [, year, month, day, hint] = m;
    const iso = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day ?? '1'))).toISOString();
    if (!Number.isFinite(Date.parse(iso))) continue;

    out.push({
      firm,
      projectHint: hint!.toLowerCase(),
      publishedAt: iso,
      reportUrl: `https://${repoKey}/blob/HEAD/${node.path}`,
    });
  }
  return out;
}

const rateLimit = { rps: 2, burst: 5 };

export const auditReportRepos: Collector<AuditReportPayload[]> = {
  id: 'audit-report-repos',
  cadence: '0 3 * * *',
  rateLimit,
  requiresCredential: 'GITHUB_TOKEN',
  async *fetch(ctx: FetchCtx): AsyncIterable<RawObservation<AuditReportPayload[]>> {
    const token = ctx.env.GITHUB_TOKEN;
    for (const src of AUDIT_REPO_SOURCES) {
      const [, owner, name] = src.repoKey.split('/');
      const url = `https://api.github.com/repos/${owner}/${name}/git/trees/HEAD?recursive=1`;
      const raw = await fetchJson<unknown>(url, {
        limit: rateLimit,
        headers: {
          accept: 'application/vnd.github+json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });
      yield makeObservation('audit-report-repos', url, parseAuditTree(raw, src.firm, src.repoKey));
    }
  },
};
