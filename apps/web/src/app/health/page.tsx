import { ConsoleNavbar } from '../../components/console-navbar';
import { isDatabaseSetupError } from '../merge-queue/database-setup';
import { loadHealthSnapshot, type HealthSnapshot } from '../../lib/ops-status';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Health' };

function formatTime(value: Date): string {
  return `${new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value)} UTC`;
}

function SetupState() {
  return (
    <main className="page-shell setup-shell" id="main-content">
      <ConsoleNavbar activeSection="health" />
      <section className="setup-panel" aria-labelledby="setup-title">
        <span className="setup-index" aria-hidden="true">DB</span>
        <div>
          <h1 id="setup-title">Connect the evidence database</h1>
          <p>Health is unavailable until PostgreSQL is running and migrations are applied.</p>
          <ol>
            <li><code>docker compose up -d postgres</code></li>
            <li><code>pnpm migrate</code></li>
          </ol>
        </div>
      </section>
    </main>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`health-badge${ok ? ' health-badge-ok' : ' health-badge-down'}`}>{label}</span>
  );
}

function HealthScreen({ snapshot }: { snapshot: HealthSnapshot }) {
  const eventLabels = {
    automate: 'Last automate',
    sync: 'Last sync',
    ingest: 'Last ingest',
    dispatch: 'Last dispatch',
    watch: 'Last watch',
  } as const;

  return (
    <main className="page-shell" id="main-content">
      <ConsoleNavbar activeSection="health" />

      <section className="route-heading" aria-labelledby="page-title">
        <div>
          <h1 id="page-title">Health</h1>
          <p>Open-Kritt reachability, provider quota, and in-flight scan dispatches.</p>
        </div>
        <p className="sync-time">
          <span>Open-Kritt</span>
          <StatusBadge ok={snapshot.krittUp} label={snapshot.krittUp ? 'Up' : 'Down'} />
        </p>
      </section>

      <section className="health-grid" aria-labelledby="automation-title">
        <h2 id="automation-title">Automation queue</h2>
        <dl className="health-events">
          <div>
            <dt>Pending merges</dt>
            <dd>{snapshot.automation.pendingMerges}</dd>
          </div>
          <div>
            <dt>Findings needing review</dt>
            <dd>{snapshot.automation.newFindings}</dd>
          </div>
          <div>
            <dt>Last automate</dt>
            <dd>
              {snapshot.automation.lastAutomate ? (
                <>
                  <time dateTime={snapshot.automation.lastAutomate.createdAt.toISOString()}>
                    {formatTime(snapshot.automation.lastAutomate.createdAt)}
                  </time>
                  {' · '}
                  <span>{snapshot.automation.lastAutomate.status}</span>
                </>
              ) : (
                'No run recorded — use pnpm automate or scripts/automate-scheduled.ps1'
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className="health-grid" aria-labelledby="ops-events-title">
        <h2 id="ops-events-title">Operator runs</h2>
        <dl className="health-events">
          {(Object.keys(eventLabels) as Array<keyof typeof eventLabels>).map((kind) => {
            const event = snapshot.lastEvents[kind];
            return (
              <div key={kind}>
                <dt>{eventLabels[kind]}</dt>
                <dd>
                  {event ? (
                    <>
                      <time dateTime={event.createdAt.toISOString()}>{formatTime(event.createdAt)}</time>
                      {' · '}
                      <span>{event.status}</span>
                      {event.message ? ` · ${event.message}` : ''}
                    </>
                  ) : (
                    'No run recorded'
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section className="health-grid" aria-labelledby="providers-title">
        <h2 id="providers-title">Providers / quota</h2>
        {snapshot.providers.length === 0 ? (
          <p className="health-empty">No account data — is Open-Kritt running?</p>
        ) : (
          <table className="target-table health-table">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Provider</th>
                <th scope="col">Status</th>
                <th scope="col">Quota</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.providers.map((row) => (
                <tr key={`${row.provider}-${row.name}`}>
                  <td>{row.name}</td>
                  <td>{row.provider}</td>
                  <td>{row.status}</td>
                  <td>{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="health-grid" aria-labelledby="dispatches-title">
        <h2 id="dispatches-title">Active dispatches</h2>
        {snapshot.dispatches.length === 0 ? (
          <p className="health-empty">No running, requested, or errored dispatches.</p>
        ) : (
          <table className="target-table health-table">
            <thead>
              <tr>
                <th scope="col">Repository</th>
                <th scope="col">Commit</th>
                <th scope="col">Radar</th>
                <th scope="col">Kritt</th>
                <th scope="col">Retry</th>
                <th scope="col">Scope</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.dispatches.map((row) => (
                <tr key={row.id}>
                  <td>{row.repoKey}</td>
                  <td><code>{row.commitSha.slice(0, 10)}</code></td>
                  <td>{row.status}</td>
                  <td>{row.krittStatus ?? (row.krittScanId ? '…' : '—')}</td>
                  <td>
                    {row.retryCount > 0 ? `${row.retryCount}${row.providerUsed ? ` · ${row.providerUsed}` : ''}` : '—'}
                  </td>
                  <td>{row.scopeFileCount ?? '—'}</td>
                  <td><time dateTime={row.updatedAt.toISOString()}>{formatTime(row.updatedAt)}</time></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

export default async function HealthPage() {
  try {
    const snapshot = await loadHealthSnapshot();
    return <HealthScreen snapshot={snapshot} />;
  } catch (error) {
    if (isDatabaseSetupError(error, process.env.DATABASE_URL)) return <SetupState />;
    throw error;
  }
}
