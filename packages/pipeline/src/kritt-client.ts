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

const SeverityRanker = z.object({
  id: z.union([z.number(), z.string()]).transform((v) => String(v)),
  name: z.string().optional(),
  content: z.string(),
  isDefault: z.boolean().optional(),
});

const NamedResourceSchema = z
  .object({
    id: z.union([z.number(), z.string()]).transform((v) => String(v)),
    name: z.string(),
  })
  .passthrough();

export interface KrittScanRequest {
  repoFull: string;
  commitSha: string;
  workflowId: string;
  postScriptId: string;
  /** Full post-script chain in run order; the first entry must be postScriptId. */
  postScriptIds?: readonly string[];
  /** Values the selected prompts reference as `{{extra.<key>}}`. */
  extra?: Record<string, string>;
  /** Required by Open-Kritt's scan validator. */
  model: string;
  harness: string;
  /** Concatenated markdown ruleset used to rank findings. */
  severityRanker: string;
  modelProvider?: string;
  thinkingEffort?: string;
  /** Markdown handoff listing paths the agent should analyze. */
  repoScope?: string;
  configuration?: { max_files: number; scope_files: string[] };
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
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `${res.status} ${res.statusText} for ${url}${detail ? `: ${detail.slice(0, 500)}` : ''}`,
    );
  }
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
   * Load a severity ranker by id, or the bundled default when id is omitted.
   * Open-Kritt refuses to create a scan without this text.
   */
  async severityRanker(id?: string): Promise<{ id: string; content: string }> {
    if (id) {
      const raw = await this.request(`${this.baseUrl}/severity-rankers/${encodeURIComponent(id)}`);
      const parsed = SeverityRanker.parse(raw);
      return { id: parsed.id, content: parsed.content };
    }

    const list = z.array(SeverityRanker).parse(await this.request(`${this.baseUrl}/severity-rankers`));
    const preferred = list.find((entry) => entry.isDefault) ?? list[0];
    if (!preferred?.content.trim()) {
      throw new Error('Open-Kritt has no severity ranker; create one in the UI before dispatching.');
    }
    return { id: preferred.id, content: preferred.content };
  }

  /**
   * Always queues rather than pre-empting. A scan already running was chosen
   * deliberately, and displacing it wastes the tokens it has spent so far.
   */
  async createScan(scan: KrittScanRequest): Promise<{ scanId: string }> {
    const body: Record<string, unknown> = {
      workflowId: scan.workflowId,
      postScriptId: scan.postScriptId,
      repo_kind: 'remote',
      repo_full: scan.repoFull,
      commit_sha: scan.commitSha,
      launchPolicy: 'queue',
      model: scan.model,
      harness: scan.harness,
      model_provider: scan.modelProvider ?? 'codex',
      thinking_effort: scan.thinkingEffort ?? 'medium',
      severity_ranker: scan.severityRanker,
    };
    if (scan.repoScope?.trim()) body.repo_scope = scan.repoScope;

    // Kritt runs `configuration.post_script_ids` in order, prefixed by the
    // scalar `postScriptId`. Sending both keeps the chain explicit while
    // satisfying the validator, which still requires the scalar.
    const configuration: Record<string, unknown> = { ...(scan.configuration ?? {}) };
    if (scan.postScriptIds && scan.postScriptIds.length > 0) {
      configuration.post_script_ids = [...scan.postScriptIds];
    }
    if (Object.keys(configuration).length > 0) body.configuration = configuration;

    // Kritt keeps only the keys the selected workflow and post-scripts declare,
    // so sending a value a chain does not reference is harmless. A blank value
    // is dropped rather than sent: Kritt reads it as missing anyway, and the
    // error reads better when it names an absent key than an empty one.
    const extra = Object.fromEntries(
      Object.entries(scan.extra ?? {}).filter(([, value]) => value.trim().length > 0),
    );
    if (Object.keys(extra).length > 0) body.extra = extra;

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

  async listWorkflows(): Promise<Array<{ id: string; name: string }>> {
    const raw = await this.request(`${this.baseUrl}/workflows`);
    return z.array(NamedResourceSchema).parse(raw).map(({ id, name }) => ({ id, name }));
  }

  /**
   * Install a workflow blueprint. Kritt refuses to edit a workflow any scan has
   * used, so provisioning creates rather than updates and the caller reuses an
   * existing workflow of the same name.
   */
  async createWorkflow(blueprint: unknown): Promise<{ id: string; name: string }> {
    const raw = await this.request(`${this.baseUrl}/workflows`, {
      method: 'POST',
      body: JSON.stringify(blueprint),
    });
    const { id, name } = NamedResourceSchema.parse(raw);
    return { id, name };
  }

  async listPostScripts(): Promise<Array<{ id: string; name: string }>> {
    const raw = await this.request(`${this.baseUrl}/post-scripts`);
    return z.array(NamedResourceSchema).parse(raw).map(({ id, name }) => ({ id, name }));
  }

  async createPostScript(blueprint: unknown): Promise<{ id: string; name: string }> {
    const raw = await this.request(`${this.baseUrl}/post-scripts`, {
      method: 'POST',
      body: JSON.stringify(blueprint),
    });
    const { id, name } = NamedResourceSchema.parse(raw);
    return { id, name };
  }

  async accounts(): Promise<unknown> {
    return this.request(`${this.baseUrl}/accounts`);
  }

  async listScans(): Promise<unknown[]> {
    const raw = await this.request(`${this.baseUrl}/scans`);
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'object' && raw !== null && Array.isArray((raw as { items?: unknown }).items)) {
      return (raw as { items: unknown[] }).items;
    }
    return [];
  }
}
