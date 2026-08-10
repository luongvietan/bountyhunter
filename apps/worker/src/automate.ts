import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { parseExclusions } from '@kritt-radar/core';
import type { PrismaClient } from '@kritt-radar/db';
import {
  formatAutoMerge,
  runAutoMerge,
  type AutoMergeResult,
} from '@kritt-radar/pipeline';

const ROOT = resolve(import.meta.dirname, '../../..');
const GENERATOR = resolve(ROOT, 'apps/worker/scripts/generate-manual-programs.mjs');

export interface AutomateOptions {
  /** Skip regenerating config/manual-programs.yml */
  skipManualPrograms?: boolean;
  /** full = catalog+github+signals; lite = signals+rank only; skip = no sync */
  syncMode?: 'full' | 'lite' | 'skip';
  /** full = watch with timeout; once = single ingest; skip = no ingest */
  watchMode?: 'full' | 'once' | 'skip';
}

export interface AutomatePhaseResult {
  manualPrograms: 'ok' | 'skipped' | 'error';
  sync: 'ok' | 'error' | 'skipped';
  autoMerge: AutoMergeResult;
  dispatch: 'ok' | 'skipped' | 'error';
  watch: 'ok' | 'skipped' | 'error';
}

function automateDispatchEnabled(): boolean {
  return process.env.RADAR_AUTOMATE_DISPATCH !== 'false';
}

function regenerateManualPrograms(): Promise<'ok' | 'skipped' | 'error'> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [GENERATOR], {
      cwd: ROOT,
      stdio: 'ignore',
      env: process.env,
    });
    child.on('error', () => resolvePromise('error'));
    child.on('exit', (code) => resolvePromise(code === 0 ? 'ok' : 'error'));
  });
}

export async function runAutomatePhases(
  prisma: PrismaClient,
  deps: {
    sync: () => Promise<void>;
    dispatchApply: () => Promise<void>;
    watch: () => Promise<void>;
    loadExclusionsYaml: () => Promise<string>;
  },
  options: AutomateOptions = {},
): Promise<AutomatePhaseResult> {
  const syncMode = options.syncMode ?? 'full';
  const watchMode = options.watchMode ?? 'full';

  const result: AutomatePhaseResult = {
    manualPrograms: 'skipped',
    sync: 'ok',
    autoMerge: {
      pending: 0,
      autoApproved: 0,
      aiApproved: 0,
      skippedConflict: 0,
      skippedLow: 0,
      skippedAi: 0,
      errors: 0,
    },
    dispatch: 'skipped',
    watch: 'skipped',
  };

  result.manualPrograms = options.skipManualPrograms
    ? 'skipped'
    : await regenerateManualPrograms();
  if (!options.skipManualPrograms && result.manualPrograms !== 'ok') {
    console.log(`[automate] manual-programs regenerate: ${result.manualPrograms}`);
  }

  if (syncMode === 'skip') {
    result.sync = 'skipped';
    console.log('[automate] sync skipped');
  } else {
    try {
      await deps.sync();
    } catch {
      result.sync = 'error';
      throw new Error('Sync failed during automate run.');
    }
  }

  const exclusions = parseExclusions(await deps.loadExclusionsYaml());
  result.autoMerge = await runAutoMerge(prisma, exclusions);
  console.log(formatAutoMerge(result.autoMerge));

  if (automateDispatchEnabled()) {
    try {
      await deps.dispatchApply();
      result.dispatch = 'ok';
      if (watchMode === 'skip') {
        result.watch = 'skipped';
      } else {
        try {
          await deps.watch();
          result.watch = 'ok';
        } catch {
          result.watch = 'error';
        }
      }
    } catch {
      result.dispatch = 'error';
    }
  }

  return result;
}
