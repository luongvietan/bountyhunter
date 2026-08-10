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
  SOLIDITY_WORKFLOW_NAME,
  parsePostScriptChain,
  parseWorkflowBlueprint,
  parsePostScriptBlueprint,
  selectPostScriptByName,
  resolvePostScriptChain,
  selectWorkflowByName,
  type ScopeSignals,
} from '@kritt-radar/pipeline';
import { collectCandidates, dispatchScans, formatPlan, type DispatchConfig } from './dispatch.js';
import { formatIngest, ingestFindings } from './ingest.js';
import { recordOpsEvent } from './ops-event.js';
import { formatRetry, retryFailedDispatches, type RetryConfig } from './retry.js';
import { runAutomatePhases, type AutomateOptions } from './automate.js';
import { watchScans } from './watch.js';
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
  return parseExclusions(
    await readFile(resolve(ROOT, 'config/exclusions.yml'), 'utf8').catch(() => 'owners: []'),
  );
}

function krittBaseUrl(): string {
  return process.env.KRITT_API_URL ?? DEFAULT_KRITT_API_URL;
}

function dispatchConfig(apply: boolean): DispatchConfig {
  const config: DispatchConfig = {
    maxScans: Number(process.env.KRITT_MAX_SCANS ?? 3),
    workflowId: process.env.KRITT_WORKFLOW_ID ?? '',
    postScriptId: process.env.KRITT_POST_SCRIPT_ID ?? '',
    postScriptIds: [],
    model: process.env.KRITT_MODEL ?? 'gpt-5.6-sol',
    harness: process.env.KRITT_HARNESS ?? 'codex',
    modelProvider: process.env.KRITT_MODEL_PROVIDER ?? 'codex',
    thinkingEffort: process.env.KRITT_THINKING_EFFORT ?? 'medium',
    severityRanker: process.env.KRITT_SEVERITY_RANKER ?? '',
    scopeFileLimit: Number(process.env.KRITT_SCOPE_FILE_LIMIT ?? 40),
    apply,
  };
  const rankerId = process.env.KRITT_SEVERITY_RANKER_ID;
  if (rankerId) config.severityRankerId = rankerId;
  return config;
}

function retryConfig(apply = true): RetryConfig {
  const base = dispatchConfig(apply);
  const config: RetryConfig = { ...base };
  const fallbackModel = process.env.KRITT_FALLBACK_MODEL;
  const fallbackHarness = process.env.KRITT_FALLBACK_HARNESS;
  const fallbackModelProvider = process.env.KRITT_FALLBACK_MODEL_PROVIDER;
  const fallbackThinkingEffort = process.env.KRITT_FALLBACK_THINKING_EFFORT;
  if (fallbackModel) config.fallbackModel = fallbackModel;
  if (fallbackHarness) config.fallbackHarness = fallbackHarness;
  if (fallbackModelProvider) config.fallbackModelProvider = fallbackModelProvider;
  if (fallbackThinkingEffort) config.fallbackThinkingEffort = fallbackThinkingEffort;
  return config;
}

async function assertKrittReachable(client: KrittClient): Promise<void> {
  if (!(await client.health())) {
    throw new Error(`Open-Kritt is not reachable at ${krittBaseUrl()}.`);
  }
}

function workflowName(): string {
  return process.env.KRITT_WORKFLOW_NAME?.trim() || SOLIDITY_WORKFLOW_NAME;
}

async function readWorkflowBlueprint() {
  return parseWorkflowBlueprint(
    await readFile(resolve(ROOT, 'config/kritt/solidity-defi-workflow.json'), 'utf8'),
  );
}

async function readFindingTriageBlueprint() {
  return parsePostScriptBlueprint(
    await readFile(resolve(ROOT, 'config/kritt/finding-triage-post-script.json'), 'utf8'),
  );
}

/**
 * Resolve the workflow and post-script chain Kritt should run. Ids are looked up
 * by name on every run: an operator who reinstalls Kritt gets new ids, and a
 * stale id in the environment would otherwise dispatch the wrong prompt.
 */
async function resolveKrittSelection<T extends DispatchConfig>(
  client: KrittClient,
  config: T,
): Promise<T> {
  const resolved = { ...config };

  if (!resolved.workflowId) {
    const name = workflowName();
    const workflow = selectWorkflowByName(await client.listWorkflows(), name);
    if (!workflow) {
      throw new Error(
        `Open-Kritt has no workflow named "${name}". Run \`pnpm provision\` to install it, ` +
          'or set KRITT_WORKFLOW_ID to pin one that already exists.',
      );
    }
    resolved.workflowId = workflow.id;
  }

  const chain = parsePostScriptChain(process.env.KRITT_POST_SCRIPT_CHAIN);
  resolved.postScriptIds = resolvePostScriptChain(await client.listPostScripts(), chain);
  // Kritt still requires the scalar and runs it first, so the chain's head has
  // to be the one that builds the proof the later scripts describe.
  resolved.postScriptId = process.env.KRITT_POST_SCRIPT_ID?.trim() || resolved.postScriptIds[0]!;
  if (!resolved.postScriptIds.includes(resolved.postScriptId)) {
    resolved.postScriptIds = [resolved.postScriptId, ...resolved.postScriptIds];
  }

  return resolved;
}

/**
 * Install the Solidity/DeFi workflow and report the post-script chain. Safe to
 * re-run: a workflow of the same name is reused rather than duplicated, because
 * Kritt refuses to edit a workflow any scan has already used.
 */
async function provision(): Promise<void> {
  const client = new KrittClient({ baseUrl: krittBaseUrl() });
  await assertKrittReachable(client);

  const blueprint = await readWorkflowBlueprint();
  const existing = selectWorkflowByName(await client.listWorkflows(), blueprint.name);
  const workflow = existing ?? (await client.createWorkflow(blueprint));
  console.log(
    `[provision] workflow ${existing ? 'already installed' : 'created'}: ` +
      `${workflow.name} (id ${workflow.id})`,
  );

  const triageBlueprint = await readFindingTriageBlueprint();
  const installedScripts = await client.listPostScripts();
  const triageExisting = selectPostScriptByName(installedScripts, triageBlueprint.name);
  const triageScript =
    triageExisting ?? (await client.createPostScript(triageBlueprint));
  console.log(
    `[provision] post-script ${triageExisting ? 'already installed' : 'created'}: ` +
      `${triageScript.name} (id ${triageScript.id})`,
  );

  const chain = parsePostScriptChain(process.env.KRITT_POST_SCRIPT_CHAIN);
  const ids = resolvePostScriptChain(await client.listPostScripts(), chain);
  console.log(
    `[provision] post-script chain: ${chain.map((name, i) => `${name} (id ${ids[i]})`).join(' -> ')}`,
  );
  console.log(
    '[provision] dispatch resolves both by name on every run; ' +
      'set KRITT_WORKFLOW_ID or KRITT_POST_SCRIPT_ID only to pin something else.',
  );
}

async function dispatch(argv: readonly string[]): Promise<void> {
  const weights = parseWeights(await readFile(resolve(ROOT, 'config/weights.yml'), 'utf8'));
  let config = dispatchConfig(argv.includes('--apply'));

  const client = new KrittClient({ baseUrl: krittBaseUrl() });
  if (config.apply) {
    await assertKrittReachable(client);
    config = await resolveKrittSelection(client, config);
  }

  const candidates = await collectCandidates(
    prisma,
    weights,
    await loadExclusions(),
    new Date(),
    config.scopeFileLimit,
  );
  const result = await dispatchScans(prisma, client, candidates, config);
  console.log(formatPlan(result, config));

  if (config.apply) {
    await recordOpsEvent(prisma, 'dispatch', result.failed > 0 ? 'error' : 'ok', undefined, {
      dispatched: result.dispatched,
      failed: result.failed,
      selected: result.plan.selected.length,
    });
  }
}

async function ingest(argv: readonly string[]): Promise<void> {
  const client = new KrittClient({ baseUrl: krittBaseUrl() });
  await assertKrittReachable(client);
  const config = await resolveKrittSelection(client, retryConfig(false));

  if (argv.includes('--watch')) {
    await watchScans(prisma, client, config);
    return;
  }

  const ingestResult = await ingestFindings(prisma, client);
  const retryResult = await retryFailedDispatches(prisma, client, config);
  console.log(formatIngest(ingestResult));
  if (retryResult.attempted > 0) console.log(formatRetry(retryResult));

  await recordOpsEvent(prisma, 'ingest', ingestResult.errors > 0 ? 'error' : 'ok', undefined, {
    ingest: ingestResult,
    retry: retryResult,
  });
}

async function watchWithTimeout(): Promise<void> {
  const client = new KrittClient({ baseUrl: krittBaseUrl() });
  await assertKrittReachable(client);
  const intervalMs = Number(process.env.KRITT_WATCH_INTERVAL_MS ?? 30_000);
  const timeoutMs = Number(process.env.RADAR_AUTOMATE_WATCH_TIMEOUT_MS ?? 25 * 60 * 1000);
  const maxIterations = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  await watchScans(prisma, client, await resolveKrittSelection(client, retryConfig(false)), {
    intervalMs,
    maxIterations,
  });
}

function parseAutomateOptions(argv: readonly string[]): AutomateOptions {
  const fast = argv.includes('--fast') || process.env.RADAR_AUTOMATE_FAST === 'true';
  if (argv.includes('--skip-sync')) {
    return {
      skipManualPrograms: fast || argv.includes('--skip-manual-programs'),
      syncMode: 'skip',
      watchMode: fast ? 'once' : argv.includes('--skip-watch') ? 'skip' : 'full',
    };
  }
  if (fast) {
    return {
      skipManualPrograms: true,
      syncMode: 'lite',
      watchMode: 'once',
    };
  }
  return {
    skipManualPrograms: argv.includes('--skip-manual-programs'),
    syncMode: 'full',
    watchMode: argv.includes('--skip-watch') ? 'skip' : 'full',
  };
}

async function automate(argv: readonly string[] = []): Promise<void> {
  const opts = parseAutomateOptions(argv);
  if (opts.syncMode === 'lite') {
    console.log('[automate] fast sync: materialize signals + rank only');
  }
  if (opts.watchMode === 'once') {
    console.log('[automate] fast watch: single ingest pass');
  }

  try {
    const phases = await runAutomatePhases(
      prisma,
      {
        sync: async () => {
          if (opts.syncMode === 'lite') {
            await materializeSignals();
            await rank();
            return;
          }
          await sync(runtimeDependencies);
        },
        dispatchApply: async () => {
          await dispatch(['--apply']);
        },
        watch: opts.watchMode === 'once' ? async () => ingest([]) : watchWithTimeout,
        loadExclusionsYaml: async () =>
          readFile(resolve(ROOT, 'config/exclusions.yml'), 'utf8').catch(() => 'owners: []'),
      },
      opts,
    );
    const ok = phases.sync !== 'error' && phases.dispatch !== 'error';
    await recordOpsEvent(prisma, 'automate', ok ? 'ok' : 'error', undefined, {
      ...phases,
      mode: opts.syncMode === 'lite' || opts.watchMode === 'once' ? 'fast' : 'full',
    });
    console.log(
      `[automate] complete manual=${phases.manualPrograms} sync=${phases.sync} ` +
        `dispatch=${phases.dispatch} watch=${phases.watch}`,
    );
  } catch (error) {
    await recordOpsEvent(
      prisma,
      'automate',
      'error',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

async function watch(): Promise<void> {
  const client = new KrittClient({ baseUrl: krittBaseUrl() });
  await assertKrittReachable(client);
  await watchScans(prisma, client, await resolveKrittSelection(client, retryConfig(false)));
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
  else if (command === 'sync') {
    try {
      await sync(runtimeDependencies);
      await recordOpsEvent(prisma, 'sync', 'ok');
    } catch (error) {
      await recordOpsEvent(
        prisma,
        'sync',
        'error',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  } else if (command === 'provision') await provision();
  else if (command === 'automate') await automate(process.argv.slice(3));
  else if (command === 'dispatch') await dispatch(process.argv.slice(3));
  else if (command === 'ingest') await ingest(process.argv.slice(3));
  else if (command === 'watch') await watch();
  else if (command === 'rank') await rank();
  else {
    console.error(
      'usage: cli.ts <collect-catalog|materialize-catalog|collect-github|materialize-signals|sync|rank|provision|automate|dispatch|ingest|watch>\n' +
        'compatibility aliases: collect=collect-catalog, materialize=materialize-catalog\n' +
        'flags: dispatch --apply, ingest --watch, automate --fast [--skip-sync] [--skip-watch] [--skip-manual-programs]',
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
