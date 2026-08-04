import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseExclusions, parseWeights, type SignalValue } from '@kritt-radar/core';
import {
  auditReportRepos,
  c4Contests,
  cantinaCompetitions,
  defillamaTvl,
  immunefiPrograms,
  makeEtherscanVerified,
  makeGithubRepoSnapshots,
  runCollector,
  sherlockContests,
  type Collector,
  type CollectorRunResult,
} from '@kritt-radar/collectors';
import { prisma, saveObservations } from '@kritt-radar/db';
import {
  listContractTargets,
  materializeEtherscanVerified,
  materializeProtocolTvl,
  materializeValueAtRisk,
  rankScopes,
  KrittClient,
  DEFAULT_KRITT_API_URL,
  type ScopeSignals,
} from '@kritt-radar/pipeline';
import { collectCandidates, dispatchScans, formatPlan } from './dispatch.js';
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
  defillamaTvl,
];

export interface SyncDependencies {
  collectCatalog: () => Promise<unknown>;
  materializeCatalog: () => Promise<unknown>;
  collectContracts: () => Promise<unknown>;
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
  await deps.collectContracts();
  await deps.collectGithub();
  await deps.materializeSignals();
  await deps.rank();
}

type CollectorPhase = 'catalog' | 'onchain' | 'github';

async function recordCollectorRun(run: CollectorRunResult, phase: CollectorPhase): Promise<void> {
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

async function collectOne(
  collector: Collector,
  phase: CollectorPhase,
): Promise<CollectorRunResult> {
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
  const tvlCount = await materializeProtocolTvl(prisma);
  console.log(`[catalog] protocolTvl: ${tvlCount} slugs`);
}

async function collectGithub(): Promise<CollectorRunResult> {
  const collector = makeGithubRepoSnapshots(() => listRepoTargets(prisma));
  return collectOne(collector, 'github');
}

async function collectContracts(): Promise<CollectorRunResult> {
  const collector = makeEtherscanVerified(() => listContractTargets(prisma));
  return collectOne(collector, 'onchain');
}

async function materializeSignals(): Promise<void> {
  const etherscanResult = await materializeEtherscanVerified(prisma);
  console.log(
    `[signals] etherscan-verified: ${etherscanResult.matched}/${etherscanResult.observations} scopes matched`,
  );
  const result = await materializeRepoSignals(prisma, new Date());
  console.log(`[signals] audit_gap: ${result.scopes} scopes / ${result.noData} no data`);
  const varCount = await materializeValueAtRisk(prisma);
  console.log(`[signals] value_at_risk: ${varCount} scopes`);
}

async function loadExclusions() {
  // A missing file excludes nothing: the target list gets noisier, never
  // quietly shorter.
  return parseExclusions(
    await readFile(resolve(ROOT, 'config/exclusions.yml'), 'utf8').catch(() => 'owners: []'),
  );
}

async function dispatch(argv: readonly string[]): Promise<void> {
  const weights = parseWeights(await readFile(resolve(ROOT, 'config/weights.yml'), 'utf8'));
  const config = {
    // Kritt runs scans one at a time, so a queue of three is roughly a day of
    // work and a misconfigured run cannot empty a budget.
    maxScans: Number(process.env.KRITT_MAX_SCANS ?? 3),
    workflowId: process.env.KRITT_WORKFLOW_ID ?? '',
    postScriptId: process.env.KRITT_POST_SCRIPT_ID ?? '',
    apply: argv.includes('--apply'),
  };

  if (config.apply && (!config.workflowId || !config.postScriptId)) {
    throw new Error(
      'Set KRITT_WORKFLOW_ID and KRITT_POST_SCRIPT_ID before dispatching; Kritt requires both.',
    );
  }

  const client = new KrittClient({ baseUrl: process.env.KRITT_API_URL ?? DEFAULT_KRITT_API_URL });
  if (config.apply && !(await client.health())) {
    throw new Error(
      `Open-Kritt is not reachable at ${process.env.KRITT_API_URL ?? DEFAULT_KRITT_API_URL}.`,
    );
  }

  const candidates = await collectCandidates(prisma, weights, await loadExclusions(), new Date());
  const result = await dispatchScans(prisma, client, candidates, config);
  console.log(formatPlan(result, config));
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
  collectContracts,
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
  else if (command === 'dispatch') await dispatch(process.argv.slice(3));
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
