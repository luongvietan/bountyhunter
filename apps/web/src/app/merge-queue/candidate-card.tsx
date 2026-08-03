import type { CSSProperties, ReactNode } from 'react';
import type { QueueCandidate, QueueEntity } from '../../lib/merge-queue';
import { DecisionForm } from './decision-form';

interface CandidateCardProps {
  candidate: QueueCandidate;
}

const dateFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

function formatDate(value: string): string {
  return `${dateFormatter.format(new Date(value))} UTC`;
}

function scorePercent(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function ScoreComponent({ label, value }: { label: string; value: number | null }) {
  const percent = value === null ? null : scorePercent(value);
  return (
    <div className="score-component">
      <span>{label}</span>
      <span className="data-value">{percent === null ? 'Not supplied' : `${percent}%`}</span>
      <span
        aria-hidden="true"
        className={`component-track${percent === null ? ' component-track-empty' : ''}`}
      >
        <span style={{ '--component-score': `${percent ?? 0}%` } as CSSProperties} />
      </span>
    </div>
  );
}

function EvidenceList({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="evidence-group">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function TextList({ empty, values }: { empty: string; values: string[] }) {
  if (values.length === 0) return <p className="empty-inline">{empty}</p>;
  return (
    <ul className="compact-list">
      {values.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  );
}

function EntityIdentity({ entity, role }: { entity: QueueEntity; role: 'Source' | 'Target' }) {
  return (
    <div className="identity-block">
      <span className="identity-role">{role}</span>
      <strong>{entity.canonicalName}</strong>
      <span className="entity-slug">{entity.slug}</span>
      <span className="entity-kind">{entity.provisional ? 'Provisional entity' : 'Canonical entity'}</span>
    </div>
  );
}

function CandidateEvidence({ source, target }: { source: QueueEntity; target: QueueEntity }) {
  return (
    <div className="evidence-columns">
      <EvidenceList title={`Audit evidence · ${source.auditReportCount}`}>
        <dl className="evidence-facts">
          <div>
            <dt>Project hints</dt>
            <dd><TextList empty="No project hints" values={source.projectHints} /></dd>
          </div>
          <div>
            <dt>Audit firms</dt>
            <dd><TextList empty="No audit firms" values={source.auditFirms} /></dd>
          </div>
        </dl>
      </EvidenceList>
      <EvidenceList title={`Program evidence · ${target.programCount}`}>
        <dl className="evidence-facts">
          <div>
            <dt>Programs</dt>
            <dd><TextList empty="No linked programs" values={target.programTitles} /></dd>
          </div>
          <div>
            <dt>Platforms</dt>
            <dd><TextList empty="No platforms" values={target.platforms} /></dd>
          </div>
        </dl>
        <div className="repository-evidence">
          <h4>Repository scopes</h4>
          {target.repoScopes.length === 0 ? (
            <p className="empty-inline">No repository scopes</p>
          ) : (
            <ul className="repo-list">
              {target.repoScopes.map((repo) => <li key={repo}>{repo}</li>)}
            </ul>
          )}
        </div>
      </EvidenceList>
    </div>
  );
}

export function CandidateCard({ candidate }: CandidateCardProps) {
  const similarity = scorePercent(candidate.similarity);
  const rationale = JSON.stringify(
    {
      similarity: candidate.similarity,
      tokenJaccard: candidate.tokenJaccard,
      editSimilarity: candidate.editSimilarity,
      candidateId: candidate.id,
    },
    null,
    2,
  );

  return (
    <article className="candidate-card" aria-labelledby={`candidate-${candidate.id}`}>
      <aside className="score-rail" aria-label={`Match score ${similarity}%`}>
        <span>Match</span>
        <strong>{similarity}%</strong>
        <div className="score-rule" aria-hidden="true">
          <span style={{ '--match-score': `${similarity}%` } as CSSProperties} />
        </div>
      </aside>

      <div className="candidate-body">
        <header className="candidate-header">
          <div>
            <div className="candidate-heading-line">
              <h2 id={`candidate-${candidate.id}`}>
                {candidate.source?.canonicalName ?? 'Ambiguous entity pair'}
              </h2>
              <span className={`status-chip status-${candidate.status}`}>{candidate.status}</span>
            </div>
            <p className="candidate-id">Candidate {candidate.id}</p>
          </div>
          <dl className="candidate-timestamps">
            <div><dt>Created</dt><dd><time dateTime={candidate.createdAt}>{formatDate(candidate.createdAt)}</time></dd></div>
            {candidate.decidedAt ? (
              <div><dt>Decided</dt><dd><time dateTime={candidate.decidedAt}>{formatDate(candidate.decidedAt)}</time></dd></div>
            ) : null}
          </dl>
        </header>

        <div className="component-scores" aria-label="Similarity components">
          <ScoreComponent label="Token overlap" value={candidate.tokenJaccard} />
          <ScoreComponent label="Edit similarity" value={candidate.editSimilarity} />
        </div>

        {candidate.source && candidate.target ? (
          <>
            <section className="identity-direction" aria-label="Proposed entity merge direction">
              <EntityIdentity entity={candidate.source} role="Source" />
              <span className="direction-arrow" aria-hidden="true">→</span>
              <span className="sr-only">will merge into</span>
              <EntityIdentity entity={candidate.target} role="Target" />
            </section>
            <CandidateEvidence source={candidate.source} target={candidate.target} />
          </>
        ) : (
          <p className="identity-unavailable">
            Entity roles cannot be assigned safely from the current evidence.
          </p>
        )}

        {candidate.blockedReason ? (
          <div className="conflict-banner" role="note">
            <strong>Approval blocked</strong>
            <p>{candidate.blockedReason} Rejection remains available and changes no entity data.</p>
          </div>
        ) : null}

        <details className="rationale-disclosure">
          <summary>Raw matching rationale</summary>
          <pre>{rationale}</pre>
        </details>

        <DecisionForm candidate={candidate} />
      </div>
    </article>
  );
}
