import { z } from 'zod';

/**
 * Open-Kritt's backend binds 127.0.0.1:3002 by default and ships with no
 * application authentication, so this client only ever talks to a loopback
 * address supplied by configuration.
 */
export const DEFAULT_KRITT_API_URL = 'http://127.0.0.1:3002/api';

const ScanCreated = z.object({
  id: z.union([z.number(), z.string()]).transform((v) => String(v)),
  status: z.string().optional(),
});

const ScanStatus = z.object({
  id: z.union([z.number(), z.string()]).transform((v) => String(v)),
  status: z.string(),
});

const VulnerabilityList = z.object({
  vulnerabilities: z.array(z.unknown()).optional(),
  items: z.array(z.unknown()).optional(),
});

export interface KrittScanRequest {
  repoFull: string;
  commitSha: string;
  workflowId: string;
  postScriptId: string;
}

export interface KrittClientOptions {
  baseUrl?: string;
  fetchJson?: (url: string, init?: RequestInit) => Promise<unknown>;
}

export class KrittLaunchPolicyError extends Error {
  constructor() {
    super('Kritt requires a launch policy because another scan is running');
    this.name = 'KrittLaunchPolicyError';
  }
}

async function defaultFetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', accept: 'application/json', ...init?.headers },
  });

  // 409 is Kritt asking which launch policy to use, not a failure. It is
  // surfaced as its own error so the caller can retry with a queue policy
  // rather than treating a busy queue as a broken scan.
  if (res.status === 409) throw new KrittLaunchPolicyError();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

export class KrittClient {
  private readonly baseUrl: string;
  private readonly request: (url: string, init?: RequestInit) => Promise<unknown>;

  constructor(options: KrittClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_KRITT_API_URL).replace(/\/+$/, '');
    this.request = options.fetchJson ?? defaultFetchJson;
  }

  async health(): Promise<boolean> {
    try {
      await this.request(`${this.baseUrl}/health`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Always queues rather than pre-empting. A scan already running was chosen
   * deliberately, and displacing it wastes the tokens it has spent so far.
   */
  async createScan(scan: KrittScanRequest): Promise<{ scanId: string }> {
    const body = {
      workflowId: scan.workflowId,
      postScriptId: scan.postScriptId,
      repo_kind: 'remote',
      repo_full: scan.repoFull,
      commit_sha: scan.commitSha,
      launchPolicy: 'queue',
    };

    const raw = await this.request(`${this.baseUrl}/scans`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return { scanId: ScanCreated.parse(raw).id };
  }

  async scanStatus(scanId: string): Promise<{ status: string }> {
    const raw = await this.request(`${this.baseUrl}/scans/${encodeURIComponent(scanId)}`);
    return { status: ScanStatus.parse(raw).status };
  }

  async scanVulnerabilities(scanId: string): Promise<unknown[]> {
    const raw = await this.request(
      `${this.baseUrl}/scans/${encodeURIComponent(scanId)}/vulnerabilities`,
    );
    if (Array.isArray(raw)) return raw;
    const parsed = VulnerabilityList.safeParse(raw);
    if (!parsed.success) return [];
    return parsed.data.vulnerabilities ?? parsed.data.items ?? [];
  }
}
