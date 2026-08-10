function scopePriority(path: string): number {
  if (/\.sol$/i.test(path)) return 0;
  if (/^contracts\//i.test(path) || /\/contracts\//i.test(path)) return 1;
  if (/^src\//i.test(path) || /\/src\//i.test(path)) return 2;
  return 3;
}

/**
 * Pick the highest-value paths to hand to Open-Kritt when the audit gap spans
 * more files than the operator budget allows.
 */
export function selectScopeFiles(
  files: readonly string[],
  options: { limit: number },
): string[] {
  const unique = [...new Set(files.filter((file) => file.trim().length > 0))];
  const sorted = unique.sort(
    (left, right) =>
      scopePriority(left) - scopePriority(right) || left.localeCompare(right),
  );
  return sorted.slice(0, Math.max(0, options.limit));
}

export function buildRepoScope(
  selectedFiles: readonly string[],
  totalCount: number,
): string {
  const lines = [
    'Only analyze these paths; ignore the rest of the repository.',
    '',
    ...selectedFiles.map((file) => `- ${file}`),
  ];
  if (totalCount > selectedFiles.length) {
    lines.push(
      '',
      `(Showing ${selectedFiles.length} of ${totalCount} changed files since last audit.)`,
    );
  }
  return lines.join('\n');
}

export function scopeConfiguration(
  selectedFiles: readonly string[],
  limit: number,
): { max_files: number; scope_files: string[] } {
  return {
    max_files: limit,
    scope_files: [...selectedFiles],
  };
}
