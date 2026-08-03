import { describe, expect, it } from 'vitest';
import { refreshCandidateReason } from '../src/foundation.js';

const approvalEvidence = {
  reportsMoved: 2,
  aliasKeys: ['aave-v3-review', 'aave-v3-security'],
  newestReport: {
    firm: 'OpenZeppelin',
    projectHint: 'aave-v3-security',
    publishedAt: '2026-07-03T00:00:00.000Z',
    reportUrl: 'https://reports.example/aave-z',
  },
};

const freshScores = { tokenJaccard: 0.75, editSimilarity: 0.5 };

describe('refreshCandidateReason', () => {
  it('preserves only a validated approval snapshot while refreshing approved scores', () => {
    expect(refreshCandidateReason('approved', {
      tokenJaccard: 0.1,
      editSimilarity: 0.2,
      staleMetadata: 'drop-me',
      approvalEvidence,
    }, freshScores)).toEqual({ ...freshScores, approvalEvidence });
  });

  it.each([
    { ...approvalEvidence, reportsMoved: -1 },
    { ...approvalEvidence, aliasKeys: [' AAVE-V3-REVIEW '] },
    { ...approvalEvidence, aliasKeys: ['aave-v3-review', 'aave-v3-review'] },
    { ...approvalEvidence, newestReport: { ...approvalEvidence.newestReport, publishedAt: 'not-a-date' } },
  ])('drops a malformed approval snapshot while refreshing scores', (malformed) => {
    expect(refreshCandidateReason('approved', { approvalEvidence: malformed }, freshScores))
      .toEqual(freshScores);
  });

  it.each(['pending', 'rejected'])('does not preserve approval evidence for %s candidates', (status) => {
    expect(refreshCandidateReason(status, { approvalEvidence }, freshScores)).toEqual(freshScores);
  });
});
