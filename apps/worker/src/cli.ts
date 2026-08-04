import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseWeights, type SignalValue } from '@kritt-radar/core';
import {
  auditReportRepos,
  c4Contests,
  cantinaCompetitions,
  immunefiPrograms,
  makeGithubRepoSnapshots,
  runCollector,
  sherlockContests,
  type Collector,
  type CollectorRunResult,
} from '@kritt-radar/collectors';
import { prisma, saveObservations } from '@kritt-radar/db';
import { rankScopes, type ScopeSignals } from '@kritt-radar/pipeline';
import {
  countDroppedContestPrograms,
  listRepoTargets,
  materializeCatalogFoundation,
  materializeRepoSignals,
} from './foundation.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const CATALOG_COLLECTORS: readonly Collector[] = [
  c4Contests,
  sherlockContests,
  cantinaCompetitions,
  immunefiPrograms,
  auditReportRepos,
];

export interface SyncDependencies {
  collectCatalog: () => Promise<unknown>;
  materializeCatalog: () => Promise<unknown>;
  collectGithub: () => Promise<unknown>;
  materializeSignals: () => Promise<unknown>;
  rank: () => Promise<unknown>;
}

/**
 * Run each stage in dependency order. Collector statuses, including `partial`
 * and `error`, are recorded results and do not interrupt later materialization;
 * a rejected stage is a hard infrastructure error and aborts the sync.
 */
export async function sync(deps: SyncDependencies): Promise<void> {
  await deps.collectCatalog();
  await deps.materializeCatalog();
  await deps.collectGithub();
  await deps.materializeSignals();
  await deps.rank();
}

async function recordCollectorRun(run: CollectorRunResult, phase: 'catalog' | 'github'): Promise<void> {
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
    `[${phase}] ${run.collectorId.padEnd(24)} ${run.status.padEnd(8)} ${run.itemCount} new${detail}`,
  );
}

async function collectOne(collector: Collector, phase: 'catalog' | 'github'): Promise<CollectorRunResult> {
  const run = await runCollector(collector, {
    env: process.env,
    save: (items) => saveObservations(items),
  });
  await recordCollectorRun(run, phase);
  return run;
}

async function collectCatalog(): Promise<CollectorRunResult[]> {
  const runs: CollectorRunResult[] = [];
  for (const collector of CATALOG_COLLECTORS) {
    runs.push(await collectOne(collector, 'catalog'));
  }
  return runs;
}

async function materializeCatalog(): Promise<void> {
  const aliasesYaml = await readFile(resolve(ROOT, 'config/aliases.yml'), 'utf8');
  const manualProgramsYaml = await readFile(resolve(ROOT, 'config/manual-programs.yml'), 'utf8').catch(
    () => '',
  );
  const droppedNoRepo = await countDroppedContestPrograms(prisma);
  const result = await materializeCatalogFoundation(
    prisma,
    aliasesYaml,
    new Date(),
    manualProgramsYaml,
  );
  console.log(
    `[catalog] foundation: ${result.programs} programs / ${result.scopes} scopes / ` +
      `${result.entities} entities / ${result.reports} firm-reports / ` +
      `${result.programAudits} program-audits / ${result.candidates} candidates` +
      (droppedNoRepo > 0 ? `  (${droppedNoRepo} dropped: no repo in list endpoint)` : ''),
  );
}

async function collectGithub(): Promise<CollectorRunResult> {
  const collector = makeGithubRepoSnapshots(() => listRepoTargets(prisma));
  return collectOne(collector, 'github');
}

async function materializeSignals(): Promise<void> {
  const result = await materializeRepoSignals(prisma, new Date());
  console.log(`[signals] audit_gap: ${result.scopes} scopes / ${result.noData} no data`);
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

const runtimeDependencies: SyncDependencies = {
  collectCatalog,
  materializeCatalog,
  collectGithub,
  materializeSignals,
  rank,
};

async function runCommand(command: string | undefined): Promise<void> {
  if (command === 'collect-catalog' || command === 'collect') await collectCatalog();
  else if (command === 'materialize-catalog' || command === 'materialize') await materializeCatalog();
  else if (command === 'collect-github') await collectGithub();
  else if (command === 'materialize-signals') await materializeSignals();
  else if (command === 'sync') await sync(runtimeDependencies);
  else if (command === 'rank') await rank();
  else {
    console.error(
      'usage: cli.ts <collect-catalog|materialize-catalog|collect-github|materialize-signals|sync|rank>\n' +
        'compatibility aliases: collect=collect-catalog, materialize=materialize-catalog',
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    await runCommand(process.argv[2]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
