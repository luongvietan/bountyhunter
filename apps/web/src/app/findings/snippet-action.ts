'use server';

import { prisma } from '@kritt-radar/db';
import { fetchCodeSnippet } from '../../lib/github-snippet';
import type { CodeSnippet } from '../../lib/github-snippet';

export async function loadFindingSnippet(findingId: string): Promise<CodeSnippet | null> {
  const finding = await prisma.finding.findUnique({
    where: { id: findingId },
    select: {
      filePath: true,
      line: true,
      dispatch: { select: { repoKey: true, commitSha: true } },
    },
  });
  if (!finding?.filePath) return null;

  await prisma.finding.update({
    where: { id: findingId },
    data: { viewedAt: new Date() },
  });

  return fetchCodeSnippet(
    finding.dispatch.repoKey,
    finding.dispatch.commitSha,
    finding.filePath,
    finding.line,
  );
}
