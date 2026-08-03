import { describe, expect, it } from 'vitest';
import * as entityFoundation from '../src/entity-foundation.js';
import * as pipeline from '../src/index.js';
import {
  auditEntitySeed,
  normalizeIdentityText,
  repoEntitySeed,
  scoreCandidate,
} from '../src/entity-foundation.js';

describe('entity identity foundation', () => {
  it('normalizes identity text by removing audit noise', () => {
    expect(normalizeIdentityText('Uniswap V4 — Audit Report')).toBe('uniswap v4');
  });

  it('removes combining marks outside the basic Unicode block', () => {
    expect(normalizeIdentityText('Un\u1ab0iswap Audit')).toBe('uniswap');
  });

  it('derives a stable entity seed from a normalized repository key', () => {
    expect(repoEntitySeed('github.com/Uniswap/v4-core')).toEqual({
      slug: 'repo-github-com-uniswap-v4-core',
      canonicalName: 'uniswap/v4-core',
    });
  });

  it('derives a stable entity seed from an audit project hint', () => {
    expect(auditEntitySeed('uniswap-v4')).toEqual({
      slug: 'audit-uniswap-v4',
      canonicalName: 'uniswap v4',
    });
  });

  it('derives the same audit seed for equivalent noisy and accented hints', () => {
    const noisySeed = auditEntitySeed('Üniswap V4 Audit Report');
    const normalizedSeed = auditEntitySeed('uniswap-v4');

    expect(noisySeed).toEqual({ slug: 'audit-uniswap-v4', canonicalName: 'uniswap v4' });
    expect(normalizedSeed).toEqual(noisySeed);
  });

  it('exports the entity foundation API from the pipeline barrel', () => {
    expect(pipeline.auditEntitySeed('uniswap-v4')).toEqual({
      slug: 'audit-uniswap-v4',
      canonicalName: 'uniswap v4',
    });
  });

  it('scores a near candidate above a distinct candidate', () => {
    const near = scoreCandidate('Uniswap v4', 'uniswap-v4 audit');
    const far = scoreCandidate('Uniswap v4', 'Aave v3');

    expect(near.similarity).toBeGreaterThan(0.8);
    expect(far.similarity).toBeLessThan(0.5);
  });

  it('exposes identity derivation and scoring without entity mutation APIs', () => {
    expect(Object.keys(entityFoundation).filter((name) => /update|merge/i.test(name))).toEqual([]);
  });
});
