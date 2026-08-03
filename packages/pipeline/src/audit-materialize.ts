import type { AuditReportPayload } from '@kritt-radar/collectors';
import { auditEntitySeed, type EntitySeed } from './entity-foundation.js';

export interface AuditObservationRow {
  id: string;
  sourceUrl: string;
  fetchedAt: Date;
  payload: unknown;
}

export interface AuditReportRecord {
  entity: EntitySeed;
  report: {
    firm: string;
    projectHint: string;
    publishedAt: Date;
    reportUrl: string;
    coveredCommit: null;
    coveredPaths: string[];
    observationIds: string[];
  };
  observationId: string;
}

function isAuditReportPayload(value: unknown): value is AuditReportPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AuditReportPayload).firm === 'string' &&
    typeof (value as AuditReportPayload).projectHint === 'string' &&
    typeof (value as AuditReportPayload).publishedAt === 'string' &&
    typeof (value as AuditReportPayload).reportUrl === 'string'
  );
}

const AUDIT_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function toValidDate(value: string): Date | null {
  if (!AUDIT_TIMESTAMP.test(value)) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;

  const parsed = new Date(timestamp);
  return parsed.toISOString() === value ? parsed : null;
}

function isNewerObservation(candidate: AuditObservationRow, current: AuditObservationRow): boolean {
  const candidateTime = candidate.fetchedAt.getTime();
  const currentTime = current.fetchedAt.getTime();
  return candidateTime > currentTime || (candidateTime === currentTime && candidate.id > current.id);
}

function latestRowsBySourceUrl(rows: readonly AuditObservationRow[]): AuditObservationRow[] {
  const latestBySource = new Map<string, AuditObservationRow>();
  for (const row of rows) {
    const current = latestBySource.get(row.sourceUrl);
    if (!current || isNewerObservation(row, current)) {
      latestBySource.set(row.sourceUrl, row);
    }
  }
  return [...latestBySource.values()];
}

export function toAuditReportRecords(rows: readonly AuditObservationRow[]): AuditReportRecord[] {
  const byReportUrl = new Map<string, { record: AuditReportRecord; observation: AuditObservationRow }>();

  for (const row of latestRowsBySourceUrl(rows)) {
    if (!Array.isArray(row.payload)) continue;

    for (const payload of row.payload) {
      if (!isAuditReportPayload(payload)) continue;
      const publishedAt = toValidDate(payload.publishedAt);
      if (!publishedAt) continue;

      const existing = byReportUrl.get(payload.reportUrl);
      if (existing && !isNewerObservation(row, existing.observation)) continue;

      byReportUrl.set(payload.reportUrl, {
        observation: row,
        record: {
          entity: auditEntitySeed(payload.projectHint),
          report: {
            firm: payload.firm,
            projectHint: payload.projectHint,
            publishedAt,
            reportUrl: payload.reportUrl,
            coveredCommit: null,
            coveredPaths: [],
            observationIds: [row.id],
          },
          observationId: row.id,
        },
      });
    }
  }

  return [...byReportUrl.values()]
    .map(({ record }) => record)
    .sort((left, right) => {
      if (left.report.reportUrl < right.report.reportUrl) return -1;
      if (left.report.reportUrl > right.report.reportUrl) return 1;
      return 0;
    });
}
