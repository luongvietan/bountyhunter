import { describe, expect, it } from 'vitest';
import { KrittClient } from '../src/kritt-client.js';

function recordingClient() {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const client = new KrittClient({
    baseUrl: 'http://127.0.0.1:3002/api',
    fetchJson: async (url, init) => {
      calls.push({
        url,
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
      });
      return { id: 42 };
    },
  });
  return { client, calls };
}

const base = {
  repoFull: 'aave/aave-v3-core',
  commitSha: 'abc123',
  workflowId: '7',
  postScriptId: '5',
  model: 'gpt-5.6-sol',
  harness: 'codex',
  severityRanker: '# ranker',
};

describe('createScan', () => {
  it('sends the post-script chain in configuration, in the order given', async () => {
    const { client, calls } = recordingClient();
    await client.createScan({ ...base, postScriptIds: ['5', '3', '9'] });

    const configuration = calls[0]!.body.configuration as Record<string, unknown>;
    expect(configuration.post_script_ids).toEqual(['5', '3', '9']);
    expect(calls[0]!.body.postScriptId).toBe('5');
  });

  it('keeps the scope configuration alongside the chain', async () => {
    const { client, calls } = recordingClient();
    await client.createScan({
      ...base,
      postScriptIds: ['5'],
      configuration: { max_files: 40, scope_files: ['src/Pool.sol'] },
    });

    expect(calls[0]!.body.configuration).toEqual({
      max_files: 40,
      scope_files: ['src/Pool.sol'],
      post_script_ids: ['5'],
    });
  });

  it('sends the bounty page as extra so the scope post-script has something to read', async () => {
    const { client, calls } = recordingClient();
    await client.createScan({ ...base, extra: { bug_bounty_url: 'https://immunefi.com/bounty/aave' } });

    expect(calls[0]!.body.extra).toEqual({ bug_bounty_url: 'https://immunefi.com/bounty/aave' });
  });

  it('drops a blank extra rather than sending an empty bounty page', async () => {
    const { client, calls } = recordingClient();
    await client.createScan({ ...base, extra: { bug_bounty_url: '  ' } });

    expect(calls[0]!.body).not.toHaveProperty('extra');
  });

  it('omits configuration and extra entirely when there is nothing to say', async () => {
    const { client, calls } = recordingClient();
    await client.createScan(base);

    expect(calls[0]!.body).not.toHaveProperty('configuration');
    expect(calls[0]!.body).not.toHaveProperty('extra');
  });

  it('always queues rather than displacing a scan already spending tokens', async () => {
    const { client, calls } = recordingClient();
    await client.createScan(base);

    expect(calls[0]!.body.launchPolicy).toBe('queue');
  });
});

describe('listPostScripts', () => {
  it('normalizes numeric ids to strings so they can be compared with configuration', async () => {
    const client = new KrittClient({
      baseUrl: 'http://127.0.0.1:3002/api',
      fetchJson: async () => [
        { id: 5, name: 'PoC Creator', description: 'x' },
        { id: '3', name: 'Report Creator' },
      ],
    });

    expect(await client.listPostScripts()).toEqual([
      { id: '5', name: 'PoC Creator' },
      { id: '3', name: 'Report Creator' },
    ]);
  });
});
