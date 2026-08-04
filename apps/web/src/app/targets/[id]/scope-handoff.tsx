'use client';

import { useMemo, useState } from 'react';
import { partitionScopeFiles } from '../../../lib/target-ranking';

interface ScopeHandoffProps {
  repoKey: string;
  commitish: string | null;
  files: string[];
}

/**
 * The point of the whole pipeline: the exact file list to paste into an
 * Open-Kritt scan scope. Rendered as selectable text as well as a button, so
 * the handoff still works when the clipboard API is unavailable.
 */
export function ScopeHandoff({ repoKey, commitish, files }: ScopeHandoffProps) {
  const [copied, setCopied] = useState(false);
  const [codeOnly, setCodeOnly] = useState(true);
  const { code, other } = useMemo(() => partitionScopeFiles(files), [files]);

  const shown = codeOnly ? code : files;
  const payload = shown.join('\n');

  async function copy() {
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked by permissions or an insecure origin. The
      // textarea below is the fallback, so this needs no error state.
      setCopied(false);
    }
  }

  if (files.length === 0) {
    return (
      <p className="scope-empty">
        No changed files recorded. This target has no measured audit gap, so there is nothing to
        hand over yet.
      </p>
    );
  }

  return (
    <div className="scope-handoff">
      <div className="scope-handoff-head">
        <div>
          <p className="scope-handoff-count">
            {shown.length} {shown.length === 1 ? 'file' : 'files'} changed since the last audit
          </p>
          <p className="scope-handoff-ref">
            {repoKey}
            {commitish ? ` @ ${commitish.slice(0, 12)}` : ''}
          </p>
        </div>
        <div className="scope-handoff-actions">
          {other.length > 0 ? (
            <label className="scope-handoff-toggle">
              <input
                checked={codeOnly}
                onChange={(event) => setCodeOnly(event.target.checked)}
                type="checkbox"
              />
              {/* Named, not hidden: a scan is billed per file, and the operator
                  should know exactly what is being left out. */}
              Hide {other.length} non-code {other.length === 1 ? 'file' : 'files'}
            </label>
          ) : null}
          <button className="button-secondary" onClick={copy} type="button">
            {copied ? 'Copied' : 'Copy file list'}
          </button>
        </div>
      </div>
      <textarea
        aria-label="Changed files since the last audit"
        className="scope-handoff-text"
        readOnly
        rows={Math.min(shown.length + 1, 16)}
        value={payload}
      />
    </div>
  );
}
