import { describe, expect, it } from 'vitest';
import { runCollector } from '../src/harness.js';
import { makeObservation, type Collector } from '../src/types.js';

const ok: Collector<{ n: number }> = {
  id: 'ok',
  cadence: '* * * * *',
  rateLimit: { rps: 10, burst: 10 },
  async *fetch() {
    yield makeObservation('ok', 'https://x/1', { n: 1 });
    yield makeObservation('ok', 'https://x/2', { n: 2 });
  },
};

const boom: Collector = {
  id: 'boom',
  cadence: '* * * * *',
  rateLimit: { rps: 10, burst: 10 },
  async *fetch() {
    throw new Error('upstream down');
  },
};

const needsKey: Collector = {
  id: 'needs-key',
  cadence: '* * * * *',
  rateLimit: { rps: 10, burst: 10 },
  requiresCredential: 'SOME_TOKEN',
  async *fetch() {
    yield makeObservation('needs-key', 'https://x/1', {});
  },
};

const partial: Collector = {
  id: 'partial',
  cadence: '* * * * *',
  rateLimit: { rps: 10, burst: 10 },
  async *fetch() {
    yield makeObservation(
      'partial',
      'https://x/1',
      { n: 1 },
      { ok: false, error: 'repo one failed' },
    );
    yield makeObservation('partial', 'https://x/2', { n: 2 }, { ok: true });
  },
};

const allFailed: Collector = {
  id: 'all-failed',
  cadence: '* * * * *',
  rateLimit: { rps: 10, burst: 10 },
  async *fetch() {
    yield makeObservation(
      'all-failed',
      'https://x/1',
      { n: 1 },
      { ok: false, error: 'repo one failed' },
    );
    yield makeObservation(
      'all-failed',
      'https://x/2',
      { n: 2 },
      { ok: false, error: 'repo two failed' },
    );
  },
};

describe('runCollector', () => {
  it('gom observation và báo ok', async () => {
    const saved: unknown[] = [];
    const r = await runCollector(ok, {
      env: {},
      save: async (o) => {
        saved.push(...o);
        return o.length;
      },
    });
    expect(r.status).toBe('ok');
    expect(r.itemCount).toBe(2);
    expect(saved).toHaveLength(2);
  });

  it('bắt lỗi thay vì ném ra ngoài, để collector khác vẫn chạy', async () => {
    const r = await runCollector(boom, { env: {}, save: async () => 0 });
    expect(r.status).toBe('error');
    expect(r.error).toContain('upstream down');
    expect(r.itemCount).toBe(0);
  });

  it('bỏ qua collector thiếu credential và coi là skipped, không phải error', async () => {
    const r = await runCollector(needsKey, { env: {}, save: async () => 0 });
    expect(r.status).toBe('skipped');
    expect(r.error).toContain('SOME_TOKEN');
  });

  it('chạy khi credential có mặt', async () => {
    const r = await runCollector(needsKey, {
      env: { SOME_TOKEN: 'x' },
      save: async (o) => o.length,
    });
    expect(r.status).toBe('ok');
    expect(r.itemCount).toBe(1);
  });

  it('saves mixed-health observations and reports a partial run', async () => {
    const saved: unknown[] = [];
    const run = await runCollector(partial, {
      env: {},
      save: async (observations) => {
        saved.push(...observations);
        return observations.length;
      },
    });

    expect(run.status).toBe('partial');
    expect(run.itemCount).toBe(2);
    expect(saved).toHaveLength(2);
  });

  it('saves all failure observations and reports an error run', async () => {
    const saved: unknown[] = [];
    const run = await runCollector(allFailed, {
      env: {},
      save: async (observations) => {
        saved.push(...observations);
        return observations.length;
      },
    });

    expect(run.status).toBe('error');
    expect(run.itemCount).toBe(2);
    expect(run.error).toContain('repo one failed');
    expect(saved).toHaveLength(2);
  });
});
