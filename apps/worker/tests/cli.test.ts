import { describe, expect, it } from 'vitest';
import { sync } from '../src/cli.js';

describe('sync', () => {
  it('collects contracts after catalog materialization and before GitHub', async () => {
    const calls: string[] = [];
    const stage = (name: string) => async () => {
      calls.push(name);
    };

    await sync({
      collectCatalog: stage('collectCatalog'),
      materializeCatalog: stage('materializeCatalog'),
      collectContracts: stage('collectContracts'),
      collectGithub: stage('collectGithub'),
      materializeSignals: stage('materializeSignals'),
      rank: stage('rank'),
    });

    expect(calls).toEqual([
      'collectCatalog',
      'materializeCatalog',
      'collectContracts',
      'collectGithub',
      'materializeSignals',
      'rank',
    ]);
  });
});
