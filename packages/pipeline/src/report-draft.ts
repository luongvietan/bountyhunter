export interface ReportFinding {
  title: string;
  vulnerabilityType: string | null;
  severity: string | null;
  impactLevel: string | null;
  filePath: string | null;
  line: number | null;
  explanation: string | null;
  maliciousInput: string | null;
  maliciousActor: string | null;
  triggerFlow: readonly string[];
  exploitable: boolean | null;
  minRewardUsd: number | null;
  maxRewardUsd: number | null;
}

export interface ReportTarget {
  repoKey: string;
  commitSha: string | null;
  programTitle: string;
  platform: string;
}

/** Platforms whose submission form has a shape worth matching. */
export type ReportFormat = 'immunefi' | 'code4rena' | 'generic';

export function reportFormatFor(platform: string): ReportFormat {
  const key = platform.trim().toLowerCase();
  if (key === 'immunefi') return 'immunefi';
  if (key === 'code4rena' || key === 'sherlock' || key === 'cantina') return 'code4rena';
  return 'generic';
}

function permalink(target: ReportTarget, finding: ReportFinding): string | null {
  if (!finding.filePath) return null;
  const ref = target.commitSha ?? 'HEAD';
  const anchor = finding.line ? `#L${finding.line}` : '';
  return `https://${target.repoKey}/blob/${ref}/${finding.filePath}${anchor}`;
}

function location(finding: ReportFinding): string {
  if (!finding.filePath) return '_Not identified._';
  return finding.line ? `\`${finding.filePath}:${finding.line}\`` : `\`${finding.filePath}\``;
}

function steps(finding: ReportFinding): string {
  if (finding.triggerFlow.length === 0) return '_No trigger flow was recorded._';
  return finding.triggerFlow.map((step, index) => `${index + 1}. ${step}`).join('\n');
}

function fallback(value: string | null, empty: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : empty;
}

/**
 * A draft, not a submission.
 *
 * Every section an agent could not fill says so rather than being omitted,
 * because a gap the reviewer can see is a gap they can close, and a report
 * that reads as complete while missing its proof is the kind that gets an
 * account banned.
 */
export function buildReport(finding: ReportFinding, target: ReportTarget): string {
  const format = reportFormatFor(target.platform);
  const link = permalink(target, finding);
  const impact = fallback(
    finding.impactLevel ?? finding.severity,
    'Not rated by the workflow',
  );

  const header = [
    `# ${finding.title}`,
    '',
    `**Target:** ${target.programTitle} (${target.platform})`,
    `**Repository:** \`${target.repoKey}\`${target.commitSha ? ` at \`${target.commitSha}\`` : ''}`,
    `**Impact:** ${impact}`,
    finding.vulnerabilityType ? `**Class:** ${finding.vulnerabilityType}` : null,
    '',
  ].filter((line): line is string => line !== null);

  const body: string[] = [];

  if (format === 'immunefi') {
    body.push(
      '## Brief',
      '',
      fallback(finding.explanation, '_Needs a written summary before submission._'),
      '',
      '## Vulnerability Details',
      '',
      `Location: ${location(finding)}`,
      link ? `\nPermalink: ${link}` : '',
      '',
      '## Impact',
      '',
      finding.maliciousActor
        ? `Reachable by: ${finding.maliciousActor}.`
        : '_Who can trigger this has not been established._',
      '',
      '## Proof of Concept',
      '',
      steps(finding),
      '',
      finding.maliciousInput
        ? `Example input:\n\n\`\`\`\n${finding.maliciousInput}\n\`\`\``
        : '_No runnable proof of concept yet. Do not submit until one exists._',
    );
  } else if (format === 'code4rena') {
    body.push(
      '## Lines of code',
      '',
      link ?? location(finding),
      '',
      '## Vulnerability details',
      '',
      fallback(finding.explanation, '_Needs a written summary before submission._'),
      '',
      '## Proof of Concept',
      '',
      steps(finding),
      '',
      finding.maliciousInput ? `\`\`\`\n${finding.maliciousInput}\n\`\`\`` : '_No proof of concept yet._',
      '',
      '## Impact',
      '',
      finding.maliciousActor
        ? `Reachable by: ${finding.maliciousActor}.`
        : '_Who can trigger this has not been established._',
    );
  } else {
    body.push(
      '## Summary',
      '',
      fallback(finding.explanation, '_Needs a written summary before submission._'),
      '',
      '## Location',
      '',
      link ?? location(finding),
      '',
      '## Steps to reproduce',
      '',
      steps(finding),
      '',
      finding.maliciousInput ? `\`\`\`\n${finding.maliciousInput}\n\`\`\`` : '_No proof of concept yet._',
    );
  }

  const caveats: string[] = ['', '---', ''];
  if (finding.exploitable !== true) {
    caveats.push(
      finding.exploitable === false
        ? '> The workflow judged this **not exploitable**. Confirm before submitting.'
        : '> Exploitability was **not established**. Confirm before submitting.',
    );
  }
  if (!finding.maliciousInput) {
    caveats.push('> No proof of concept was produced. Most programs reject reports without one.');
  }
  caveats.push('> Drafted from an automated scan. Verify every claim before submitting.');

  return [...header, ...body, ...caveats].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
