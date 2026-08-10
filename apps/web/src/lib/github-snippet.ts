export interface SnippetLine {
  number: number;
  text: string;
  highlight: boolean;
}

export interface CodeSnippet {
  filePath: string;
  commitSha: string;
  startLine: number;
  lines: SnippetLine[];
}

/** `github.com/owner/repo` → `{ owner, repo }` */
export function parseRepoKey(repoKey: string): { owner: string; repo: string } | null {
  const match = repoKey.trim().match(/^github\.com\/([^/]+)\/([^/]+)$/i);
  if (!match || !match[1] || !match[2]) return null;
  return { owner: match[1], repo: match[2] };
}

export function rawFileUrl(repoKey: string, commitSha: string, filePath: string): string | null {
  const parts = parseRepoKey(repoKey);
  if (!parts) return null;
  const path = filePath.replace(/^\/+/, '');
  return `https://raw.githubusercontent.com/${parts.owner}/${parts.repo}/${commitSha}/${path}`;
}

export function sliceSnippet(
  filePath: string,
  commitSha: string,
  content: string,
  line: number | null,
  context = 8,
): CodeSnippet {
  const rows = content.split(/\r?\n/);
  const focus = line && line > 0 ? line : 1;
  const start = Math.max(1, focus - context);
  const end = Math.min(rows.length, focus + context);
  const lines: SnippetLine[] = [];
  for (let n = start; n <= end; n += 1) {
    lines.push({
      number: n,
      text: rows[n - 1] ?? '',
      highlight: line !== null && n === line,
    });
  }
  return { filePath, commitSha, startLine: start, lines };
}

export async function fetchCodeSnippet(
  repoKey: string,
  commitSha: string,
  filePath: string,
  line: number | null,
): Promise<CodeSnippet | null> {
  const url = rawFileUrl(repoKey, commitSha, filePath);
  if (!url) return null;

  const response = await fetch(url, {
    headers: { accept: 'text/plain' },
    next: { revalidate: 3600 },
  });
  if (!response.ok) return null;

  const content = await response.text();
  return sliceSnippet(filePath, commitSha, content, line);
}
