import { describe, expect, it } from 'vitest';
import { mergeManualImmunefiPrograms, parseManualPrograms } from '../src/manual-programs.js';
import type { MultiScopeRecord } from '../src/materialize.js';

const yaml = `
sparklend:
  platform: immunefi
  externalId: sparklend
  title: Spark
  url: https://immunefi.com/bounty/sparklend/
  poolUsd: 5000000
  repos:
    - github.com/sparkdotfi/sparklend
    - github.com/sparkdotfi/spark-psm
    - github.com/marsfoundation/sparklend

gmx:
  platform: immunefi
  externalId: gmx
  title: GMX
  url: https://immunefi.com/bounty/gmx/
  repos:
    - github.com/gmx-io/gmx-synthetics
    - github.com/gmx-io/gmx-contracts
`;

describe('parseManualPrograms', () => {
  it('chuẩn hoá repo key và bỏ trùng', () => {
    const records = parseManualPrograms(yaml);
    expect(records).toHaveLength(2);
    const spark = records.find((r) => r.program.externalId === 'sparklend');
    expect(spark?.scopes).toHaveLength(3);
    expect(spark?.scopes.map((s) => s.hardKey)).toEqual([
      'github.com/sparkdotfi/sparklend',
      'github.com/sparkdotfi/spark-psm',
      'github.com/marsfoundation/sparklend',
    ]);
  });
});

describe('mergeManualImmunefiPrograms', () => {
  const immunefi: MultiScopeRecord[] = [
    {
      program: {
        platform: 'immunefi',
        externalId: 'sparklend',
        title: 'Spark',
        url: 'https://immunefi.com/bounty/sparklend/',
        poolUsd: null,
        kind: 'bounty',
        publishedAt: null,
        startsAt: null,
        endsAt: null,
      },
      scopes: [
        {
          kind: 'repo',
          hardKey: 'github.com/marsfoundation/sparklend',
          repoUrl: 'github.com/marsfoundation/sparklend',
          pathGlobs: [],
          addedAt: null,
        },
      ],
      audits: [],
      changedAt: null,
    },
  ];

  it('bổ sung repo mới vào program Immunefi đã có', () => {
    const merged = mergeManualImmunefiPrograms(immunefi, parseManualPrograms(yaml));
    const spark = merged.find((r) => r.program.externalId === 'sparklend');
    expect(spark?.scopes).toHaveLength(3);
    expect(spark?.program.poolUsd).toBe(5_000_000);
  });

  it('thêm program Immunefi mới khi mirror chưa có repo GitHub', () => {
    const merged = mergeManualImmunefiPrograms(immunefi, parseManualPrograms(yaml));
    const gmx = merged.find((r) => r.program.externalId === 'gmx');
    expect(gmx?.scopes).toHaveLength(2);
  });
});
