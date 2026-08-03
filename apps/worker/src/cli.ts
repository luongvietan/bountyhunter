import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseWeights, type SignalValue } from '@kritt-radar/core';
import {
  auditReportRepos,
  c4Contests,
  cantinaCompetitions,
  immunefiPrograms,
  runCollector,
  sherlockContests,
} from '@kritt-radar/collectors';
import { prisma, saveObservations } from '@kritt-radar/db';
import { rankScopes, type ScopeSignals } from '@kritt-radar/pipeline';
import { materializeCatalogFoundation } from './foundation.js';

const ROOT = resolve(import.meta.dirname, '../../..');

async function collect(): Promise<void> {
  const collectors = [
    c4Contests,
    sherlockContests,
    cantinaCompetitions,
    immunefiPrograms,
    auditReportRepos,
  ];

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

async function materialize(): Promise<void> {
  const aliasesYaml = await readFile(resolve(ROOT, 'config/aliases.yml'), 'utf8');
  const result = await materializeCatalogFoundation(prisma, aliasesYaml, new Date());
  console.log(
    `foundation: ${result.programs} programs / ${result.scopes} scopes / ` +
      `${result.entities} entities / ${result.reports} reports / ${result.candidates} candidates`,
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
