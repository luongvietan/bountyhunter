import { z } from 'zod';
import { normalizeRepoUrl } from '@kritt-radar/core';
import { fetchJson } from '../http.js';
import { makeObservation, type Collector, type FetchCtx } from '../types.js';

const MIRROR_REPO = 'infosec-us-team/Immunefi-Bug-Bounty-Programs-Unofficial';
const PROJECTS_URL = `https://raw.githubusercontent.com/${MIRROR_REPO}/main/projects.json`;
const COMMITS_URL = `https://api.github.com/repos/${MIRROR_REPO}/commits?per_page=1`;

const MAX_MIRROR_AGE_MS = 7 * 24 * 3_600_000;

const RawAsset = z.object({
  id: z.string(),
  url: z.string(),
  type: z.string().optional(),
  addedAt: z.string().optional(),
});

const RawAudit = z.object({
  id: z.string(),
  auditor: z.string().nullish(),
  date: z.string(),
  url: z.string().nullish(),
});

const RawProject = z.object({
  slug: z.string(),
  project: z.string(),
  maxBounty: z.number().nullish(),
  rewardsPool: z.number().nullish(),
  launchDate: z.string().nullish(),
  updatedDate: z.string().nullish(),
  inviteOnly: z.boolean().nullish(),
  assets: z.array(z.unknown()).optional(),
  audits: z.array(z.unknown()).optional(),
});

export interface ImmunefiAsset {
  assetId: string;
  repoKey: string;
  type: string | null;
  addedAt: string | null;
}

export interface ImmunefiAudit {
  /** Khoá ổn định của Immunefi. Dùng cái này, KHÔNG dùng `url` — url trùng nhau. */
  auditId: string;
  auditor: string | null;
  /** ISO. Đã kiểm tra parse được ngay lúc thu thập. */
  date: string;
  sourceUrl: string | null;
}

export interface ImmunefiProgramPayload {
  platform: 'immunefi';
  externalId: string;
  title: string;
  url: string;
  poolUsd: number | null;
  maxBountyUsd: number | null;
  kind: 'bounty';
  publishedAt: string | null;
  updatedAt: string | null;
  assets: ImmunefiAsset[];
  /**
   * Audit mà Immunefi khai cho chính program này.
   *
   * Giá trị nằm ở chỗ nó gắn sẵn vào program, mà program đã liên kết tới scope,
   * nên `audit_gap` có mốc thời gian thật mà không cần khớp tên dự án — cách
   * khớp tên chỉ trúng dưới 1%.
   */
  audits: ImmunefiAudit[];
}

function parseAudits(raw: unknown): ImmunefiAudit[] {
  if (!Array.isArray(raw)) return [];
  const out: ImmunefiAudit[] = [];
  for (const item of raw) {
    const parsed = RawAudit.safeParse(item);
    if (!parsed.success) continue;
    const a = parsed.data;
    // Ngày hỏng thì bỏ hẳn: một mốc audit sai còn tệ hơn không có mốc nào, vì nó
    // làm audit_gap tính diff từ một điểm không có thật.
    if (!Number.isFinite(Date.parse(a.date))) continue;
    out.push({
      auditId: a.id,
      auditor: a.auditor ?? null,
      date: a.date,
      sourceUrl: a.url ?? null,
    });
  }
  return out;
}

export function parseImmunefiProjects(raw: unknown): Array<{
  collectorId: string;
  sourceUrl: string;
  payload: ImmunefiProgramPayload;
  contentHash: string;
}> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{
    collectorId: string;
    sourceUrl: string;
    payload: ImmunefiProgramPayload;
    contentHash: string;
  }> = [];

  for (const item of raw) {
    const parsed = RawProject.safeParse(item);
    if (!parsed.success) continue;
    const p = parsed.data;

    // Program inviteOnly không nộp report được nếu chưa được mời — xếp hạng nó
    // chỉ tạo ra mục tiêu không hành động được.
    if (p.inviteOnly) continue;

    const assets: ImmunefiAsset[] = [];
    for (const a of p.assets ?? []) {
      const asset = RawAsset.safeParse(a);
      if (!asset.success) continue;
      const repoKey = normalizeRepoUrl(asset.data.url);
      if (!repoKey) continue; // bỏ website, endpoint API, địa chỉ contract
      assets.push({
        assetId: asset.data.id,
        repoKey,
        type: asset.data.type ?? null,
        addedAt: asset.data.addedAt ?? null,
      });
    }

    if (assets.length === 0) continue; // không có code thì không tính audit_gap được

    const payload: ImmunefiProgramPayload = {
      platform: 'immunefi',
      externalId: p.slug,
      title: p.project,
      url: `https://immunefi.com/bounty/${p.slug}/`,
      poolUsd: p.rewardsPool && p.rewardsPool > 0 ? p.rewardsPool : null,
      maxBountyUsd: p.maxBounty && p.maxBounty > 0 ? p.maxBounty : null,
      kind: 'bounty',
      publishedAt: p.launchDate ?? null,
      updatedAt: p.updatedDate ?? null,
      assets,
      audits: parseAudits(p.audits),
    };
    out.push(makeObservation('immunefi-programs', payload.url, payload));
  }
  return out;
}

const rateLimit = { rps: 2, burst: 4 };

/**
 * Mirror do cộng đồng duy trì, không phải nguồn chính thức.
 * Dữ liệu cũ trông y hệt dữ liệu mới, nên nếu bot ngừng chạy ta phải biết ngay —
 * ném lỗi để harness ghi status=error thay vì âm thầm phục vụ dữ liệu ôi.
 */
async function assertMirrorFresh(token: string | undefined, now: Date): Promise<void> {
  const commits = await fetchJson<Array<{ commit?: { committer?: { date?: string } } }>>(
    COMMITS_URL,
    {
      limit: rateLimit,
      headers: {
        accept: 'application/vnd.github+json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    },
  );
  const date = commits[0]?.commit?.committer?.date;
  if (!date) throw new Error('immunefi mirror: could not read last commit date');
  const age = now.getTime() - Date.parse(date);
  if (age > MAX_MIRROR_AGE_MS) {
    throw new Error(
      `immunefi mirror stale: last commit ${date} (${Math.round(age / 86_400_000)}d old)`,
    );
  }
}

export const immunefiPrograms: Collector<ImmunefiProgramPayload> = {
  id: 'immunefi-programs',
  cadence: '0 */6 * * *',
  rateLimit,
  async *fetch(ctx: FetchCtx) {
    await assertMirrorFresh(ctx.env.GITHUB_TOKEN, ctx.now());
    const raw = await fetchJson<unknown>(PROJECTS_URL, { limit: rateLimit });
    yield* parseImmunefiProjects(raw);
  },
};
