import { describe, expect, it } from 'vitest';
import { toAuditReportRecords, type AuditObservationRow } from '../src/audit-materialize.js';

const rows: AuditObservationRow[] = [
  {
    id: 'observation-old',
    sourceUrl: 'https://api.github.com/repos/trailofbits/publications/git/trees/old',
    fetchedAt: new Date('2026-03-01T00:00:00.000Z'),
    payload: [
      {
        firm: 'trailofbits',
        projectHint: 'legacy-project',
        publishedAt: '2026-03-01T00:00:00.000Z',
        reportUrl: 'https://github.com/trailofbits/publications/blob/master/reports/legacy-project.pdf',
      },
    ],
  },
  {
    id: 'observation-latest-source',
    sourceUrl: 'https://api.github.com/repos/trailofbits/publications/git/trees/old',
    fetchedAt: new Date('2026-04-02T00:00:00.000Z'),
    payload: [
      {
        firm: 'trailofbits',
        projectHint: 'uniswap-v4',
        publishedAt: '2026-04-01T00:00:00.000Z',
        reportUrl: 'https://github.com/trailofbits/publications/blob/master/reports/uniswap-v4.pdf',
      },
      {
        firm: 'trailofbits',
        projectHint: 'bad-date',
        publishedAt: 'not-a-date',
        reportUrl: 'https://github.com/trailofbits/publications/blob/master/reports/bad-date.pdf',
      },
    ],
  },
  {
    id: 'observation-newest-duplicate',
    sourceUrl: 'https://api.github.com/repos/openzeppelin/openzeppelin-contracts/git/trees/current',
    fetchedAt: new Date('2026-04-03T00:00:00.000Z'),
    payload: [
      {
        firm: 'OpenZeppelin',
        projectHint: 'uniswap-v4',
        publishedAt: '2026-04-01T00:00:00.000Z',
        reportUrl: 'https://github.com/trailofbits/publications/blob/master/reports/uniswap-v4.pdf',
      },
    ],
  },
  {
    id: 'observation-malformed',
    sourceUrl: 'https://api.github.com/repos/example/malformed/git/trees/current',
    fetchedAt: new Date('2026-04-04T00:00:00.000Z'),
    payload: { reports: [] },
  },
];

describe('toAuditReportRecords', () => {
  it('keeps the latest source observation, drops invalid reports, and preserves the selected observation ID', () => {
    const records = toAuditReportRecords(rows);

    expect(records).toHaveLength(1);
    expect(records[0]!.entity.slug).toBe('audit-uniswap-v4');
    expect(records[0]!.report.projectHint).toBe('uniswap-v4');
    expect(records[0]!.report.publishedAt).toEqual(new Date('2026-04-01T00:00:00.000Z'));
    expect(records[0]!.observationId).toBe('observation-newest-duplicate');
    expect(records[0]!.report.observationIds).toEqual(['observation-newest-duplicate']);
    expect(records[0]!.report.coveredCommit).toBeNull();
    expect(records[0]!.report.coveredPaths).toEqual([]);
  });

  it('uses observation ID as a deterministic tie-breaker for equal fetch times', () => {
    const duplicateUrl = 'https://github.com/auditor/reports/blob/main/shared.pdf';
    const records = toAuditReportRecords([
      {
        id: 'observation-a',
        sourceUrl: 'https://api.github.com/repos/auditor/source-a/git/trees/current',
        fetchedAt: new Date('2026-05-01T00:00:00.000Z'),
        payload: [
          {
            firm: 'Auditor A',
            projectHint: 'shared-project',
            publishedAt: '2026-04-01T00:00:00.000Z',
            reportUrl: duplicateUrl,
          },
        ],
      },
      {
        id: 'observation-z',
        sourceUrl: 'https://api.github.com/repos/auditor/source-z/git/trees/current',
        fetchedAt: new Date('2026-05-01T00:00:00.000Z'),
        payload: [
          {
            firm: 'Auditor Z',
            projectHint: 'shared-project',
            publishedAt: '2026-04-01T00:00:00.000Z',
            reportUrl: duplicateUrl,
          },
        ],
      },
    ]);

    expect(records[0]!.observationId).toBe('observation-z');
  });

  it('drops ISO timestamps with impossible calendar dates', () => {
    const records = toAuditReportRecords([
      {
        id: 'observation-impossible-date',
        sourceUrl: 'https://api.github.com/repos/auditor/impossible-date/git/trees/current',
        fetchedAt: new Date('2026-05-01T00:00:00.000Z'),
        payload: [
          {
            firm: 'Auditor',
            projectHint: 'impossible-date',
            publishedAt: '2026-02-30T00:00:00.000Z',
            reportUrl: 'https://reports.example/impossible-date.pdf',
          },
        ],
      },
    ]);

    expect(records).toEqual([]);
  });

  it('orders distinct report URLs deterministically', () => {
    const records = toAuditReportRecords([
      {
        id: 'observation-z',
        sourceUrl: 'https://api.github.com/repos/auditor/z/git/trees/current',
        fetchedAt: new Date('2026-05-01T00:00:00.000Z'),
        payload: [
          {
            firm: 'Auditor',
            projectHint: 'z-project',
            publishedAt: '2026-04-01T00:00:00.000Z',
            reportUrl: 'https://reports.example/z.pdf',
          },
        ],
      },
      {
        id: 'observation-a',
        sourceUrl: 'https://api.github.com/repos/auditor/a/git/trees/current',
        fetchedAt: new Date('2026-05-01T00:00:00.000Z'),
        payload: [
          {
            firm: 'Auditor',
            projectHint: 'a-project',
            publishedAt: '2026-04-01T00:00:00.000Z',
            reportUrl: 'https://reports.example/a.pdf',
          },
        ],
      },
    ]);

    expect(records.map((record) => record.report.reportUrl)).toEqual([
      'https://reports.example/a.pdf',
      'https://reports.example/z.pdf',
    ]);
  });
});
