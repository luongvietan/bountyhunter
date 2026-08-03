import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseWeights, type SignalValue } from '@kritt-radar/core';
import {
  c4Contests,
  cantinaCompetitions,
  immunefiPrograms,
  runCollector,
  sherlockContests,
} from '@kritt-radar/collectors';
import { prisma, saveObservations } from '@kritt-radar/db';
import {
  extractFreshness,
  latestBySourceUrl,
  rankScopes,
  toImmunefiRecords,
  toProgramRecords,
  type ProgramFields,
  type ScopeSignals,
} from '@kritt-radar/pipeline';

const ROOT = resolve(import.meta.dirname, '../../..');

const CONTEST_COLLECTORS = ['c4-contests', 'sherlock-contests', 'cantina-competitions'];

async function collect(): Promise<void> {
  const collectors = [c4Contests, sherlockContests, cantinaCompetitions, immunefiPrograms];

  for (const c of collectors) {
    const run = await runCollector(c, {
      env: process.env,
      save: (items) => saveObservations(items),
    });
    await prisma.collectorRun.create({
      data: {
        collectorId: run.collectorId,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        status: run.status,
        itemCount: run.itemCount,
        error: run.error ?? null,
      },
    });
    const detail = run.error ? `  (${run.error})` : '';
    console.log(
      `${run.collectorId.padEnd(24)} ${run.status.padEnd(8)} ${run.itemCount} new${detail}`,
    );
  }
}

/** Ghi Program + Scope, rồi tính lại freshness cho từng scope. */
async function upsertProgram(
  program: ProgramFields,
  scopes: ReadonlyArray<{ hardKey: string; repoUrl: string; pathGlobs: string[] }>,
  freshnessAt: ReadonlyArray<Date | null>,
  fallbackChangedAt: Date,
  now: Date,
): Promise<number> {
  const saved = await prisma.program.upsert({
    where: {
      platform_externalId: { platform: program.platform, externalId: program.externalId },
    },
    create: program,
    update: program,
  });

  for (const [i, sc] of scopes.entries()) {
    const existing = await prisma.scope.findFirst({
      where: { programId: saved.id, hardKey: sc.hardKey },
    });
    const scope =
      existing ??
      (await prisma.scope.create({
        data: {
          programId: saved.id,
          kind: 'repo',
          hardKey: sc.hardKey,
          repoUrl: sc.repoUrl,
          pathGlobs: sc.pathGlobs,
        },
      }));

    // addedAt của asset chính xác hơn ngày mở program: một repo thêm hôm qua
    // vào một program mở từ 2025 vẫn là scope mới tinh.
    const scopeChangedAt = freshnessAt[i] ?? fallbackChangedAt;
    const freshness = extractFreshness(
      { publishedAt: program.publishedAt ?? undefined, scopeChangedAt },
      now,
    );

    await prisma.signal.upsert({
      where: { scopeId_type: { scopeId: scope.id, type: freshness.type } },
      create: {
        scopeId: scope.id,
        type: freshness.type,
        value: freshness.value,
        confidence: freshness.confidence,
        evidence: freshness.evidence as never,
        observationIds: [],
      },
      update: {
        value: freshness.value,
        confidence: freshness.confidence,
        evidence: freshness.evidence as never,
        computedAt: now,
      },
    });
  }

  return scopes.length;
}

async function materialize(): Promise<void> {
  const now = new Date();

  const contestRows = await prisma.observation.findMany({
    where: { collectorId: { in: CONTEST_COLLECTORS } },
    select: { sourceUrl: true, fetchedAt: true, payload: true },
  });
  const latestContests = latestBySourceUrl(contestRows);
  const contests = toProgramRecords(latestContests);
  // Không im lặng cắt dữ liệu: một collector trả 50 program mà 50 cái đều rơi
  // vì thiếu repo trông y hệt "hôm nay không có gì mới".
  const droppedNoRepo = latestContests.length - contests.length;

  let contestScopes = 0;
  for (const r of contests) {
    contestScopes += await upsertProgram(
      r.program,
      [r.scope],
      [r.changedAt],
      r.changedAt,
      now,
    );
  }

  const immunefiRows = await prisma.observation.findMany({
    where: { collectorId: 'immunefi-programs' },
    select: { sourceUrl: true, fetchedAt: true, payload: true },
  });
  const immunefi = toImmunefiRecords(latestBySourceUrl(immunefiRows));

  let immunefiScopes = 0;
  for (const r of immunefi) {
    immunefiScopes += await upsertProgram(
      r.program,
      r.scopes,
      r.scopes.map((s) => s.addedAt),
      r.changedAt,
      now,
    );
  }

  console.log(
    `contests: ${contests.length} programs / ${contestScopes} scopes` +
      (droppedNoRepo > 0 ? `  (${droppedNoRepo} dropped: no repo in list endpoint)` : '') +
      `\nimmunefi: ${immunefi.length} programs / ${immunefiScopes} scopes`,
  );
}

async function rank(): Promise<void> {
  const weights = parseWeights(await readFile(resolve(ROOT, 'config/weights.yml'), 'utf8'));

  const scopes = await prisma.scope.findMany({ include: { program: true, signals: true } });

  const input: ScopeSignals[] = scopes.map((s) => ({
    scopeId: s.id,
    title: `${s.program.title} :: ${s.hardKey ?? '?'}`,
    signals: s.signals.map(
      (sig): SignalValue => ({
        type: sig.type as SignalValue['type'],
        value: sig.value,
        confidence: sig.confidence,
        evidence: sig.evidence as Record<string, unknown>,
      }),
    ),
  }));

  const ranked = rankScopes(input, weights);

  console.log(`\n${'#'.padEnd(5)}${'SCORE'.padEnd(8)}${'TARGET'.padEnd(64)}SIGNALS`);
  for (const [i, r] of ranked.slice(0, 25).entries()) {
    const parts = r.score.breakdown.map((b) => `${b.type}=${b.value.toFixed(2)}`).join(' ');
    const skipped = r.score.skipped.length ? `  [no data: ${r.score.skipped.join(',')}]` : '';
    console.log(
      `${String(i + 1).padEnd(5)}${r.score.total.toFixed(1).padEnd(8)}${r.title.slice(0, 62).padEnd(64)}${parts}${skipped}`,
    );
  }
  console.log(`\nweights: ${weights.version}   scopes: ${ranked.length}\n`);
}

const command = process.argv[2];

try {
  if (command === 'collect') await collect();
  else if (command === 'materialize') await materialize();
  else if (command === 'rank') await rank();
  else {
    console.error('usage: cli.ts <collect|materialize|rank>');
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
