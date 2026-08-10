'use client';

import { useEffect, useState, useTransition } from 'react';
import type { CodeSnippet } from '../../lib/github-snippet';
import { loadFindingSnippet } from './snippet-action';

type CodeView = 'inline' | 'github';

interface CodeLocationPanelProps {
  findingId: string;
  filePath: string;
  line: number | null;
  commitSha: string;
  permalink: string | null;
}

export function CodeLocationPanel({
  findingId,
  filePath,
  line,
  commitSha,
  permalink,
}: CodeLocationPanelProps) {
  const [view, setView] = useState<CodeView>('inline');
  const [snippet, setSnippet] = useState<CodeSnippet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (view !== 'inline') return;
    startTransition(async () => {
      try {
        const result = await loadFindingSnippet(findingId);
        if (!result) {
          setError('Could not load source from GitHub at this commit.');
          setSnippet(null);
          return;
        }
        setSnippet(result);
        setError(null);
      } catch {
        setError('Failed to fetch inline code.');
        setSnippet(null);
      }
    });
  }, [view, findingId]);

  if (!filePath) return null;

  return (
    <section className="finding-code-panel" aria-labelledby={`code-${findingId}`}>
      <div className="finding-code-head">
        <h3 id={`code-${findingId}`}>Code location</h3>
        <div className="finding-code-toggle" role="tablist" aria-label="Code view">
          <button
            aria-selected={view === 'inline'}
            className={view === 'inline' ? 'finding-code-tab finding-code-tab-active' : 'finding-code-tab'}
            onClick={() => setView('inline')}
            role="tab"
            type="button"
          >
            Inline
          </button>
          <button
            aria-selected={view === 'github'}
            className={view === 'github' ? 'finding-code-tab finding-code-tab-active' : 'finding-code-tab'}
            onClick={() => setView('github')}
            role="tab"
            type="button"
          >
            GitHub
          </button>
        </div>
      </div>

      <p className="finding-code-meta">
        <code>
          {filePath}
          {line ? `:${line}` : ''}
        </code>
        {' · '}
        <code>{commitSha.slice(0, 10)}</code>
      </p>

      {view === 'github' ? (
        <div className="finding-code-github">
          {permalink ? (
            <>
              <a href={permalink} rel="noreferrer" target="_blank">
                Open on GitHub
              </a>
              <p className="finding-code-url">
                Permalink opens the exact commit and line in the browser. Inline view loads the same
                file here for side-by-side reading without leaving the queue.
              </p>
              <code className="finding-code-permalink">{permalink}</code>
            </>
          ) : (
            <p className="finding-code-error">No GitHub permalink for this location.</p>
          )}
        </div>
      ) : pending ? (
        <p className="finding-code-loading">Loading source…</p>
      ) : error ? (
        <p className="finding-code-error">
          {error}{' '}
          {permalink ? (
            <a href={permalink} rel="noreferrer" target="_blank">
              Open on GitHub instead
            </a>
          ) : null}
        </p>
      ) : snippet ? (
        <pre className="finding-code-snippet">
          <code>
            {snippet.lines.map((row) => (
              <div
                className={row.highlight ? 'finding-code-line finding-code-line-focus' : 'finding-code-line'}
                key={row.number}
              >
                <span className="finding-code-gutter">{row.number}</span>
                <span>{row.text || ' '}</span>
              </div>
            ))}
          </code>
        </pre>
      ) : null}
    </section>
  );
}
