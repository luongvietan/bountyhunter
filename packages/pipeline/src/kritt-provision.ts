import { z } from 'zod';

/**
 * The bundled Open-Kritt post-scripts, in the order a bounty submission needs
 * them: build the proof first, write the report around it, then ask whether the
 * attacker the finding assumes is even eligible under the program.
 */
export const DEFAULT_POST_SCRIPT_CHAIN = [
  'PoC Creator',
  'Report Creator',
  'Is Malicious Actor in scope',
] as const;

/** Name of the workflow this repository ships for smart-contract targets. */
export const SOLIDITY_WORKFLOW_NAME = 'Solidity DeFi Value Flow';

const FIELD_TYPES = ['string', 'number', 'boolean', 'array', 'object'] as const;

/** Mirrors Open-Kritt's terminal-step contract so a bad blueprint fails here. */
const REQUIRED_FINDING_KEYS = [
  'explanation',
  'file_path',
  'line',
  'malicious_input_example',
  'summary',
  'trigger_flow',
  'vulnerability_type',
  'malicious_actor',
] as const;

const Step = z.object({
  name: z.string().optional(),
  content: z.string().min(1),
});

const Level = z.object({
  depth: z.number().int().nonnegative(),
  multiOutput: z.boolean().optional(),
  consumesAll: z.boolean().optional(),
  outputFormat: z.record(z.enum(FIELD_TYPES)),
  steps: z.array(Step).min(1),
});

const Blueprint = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  levels: z.array(Level).min(1),
});

export type WorkflowBlueprint = z.infer<typeof Blueprint>;

const PostScriptBlueprint = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  content: z.string().min(1),
  outputFormat: z.record(z.enum(FIELD_TYPES)),
});

export type PostScriptBlueprint = z.infer<typeof PostScriptBlueprint>;

export interface NamedResource {
  id: string;
  name: string;
}

/**
 * Read a workflow blueprint from disk contents. Open-Kritt validates the same
 * rules server side, but a blueprint that fails there costs a round trip and
 * returns field paths rather than the file the operator has to edit.
 */
export function parseWorkflowBlueprint(json: string): WorkflowBlueprint {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('The workflow blueprint is not valid JSON.');
  }

  const parsed = Blueprint.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `The workflow blueprint is malformed: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'root'} ${issue.message.toLowerCase()}`)
        .join('; ')}`,
    );
  }
  const blueprint = parsed.data;

  const depths = blueprint.levels.map((level) => level.depth);
  const expected = [...depths].sort((left, right) => left - right);
  const contiguous = expected.every((depth, index) => depth === index);
  if (new Set(depths).size !== depths.length || !contiguous) {
    throw new Error('Workflow depths must be unique and contiguous from 0.');
  }

  const maxDepth = Math.max(...depths);
  const terminal = blueprint.levels.find((level) => level.depth === maxDepth)!;
  const missing = REQUIRED_FINDING_KEYS.filter((key) => !(key in terminal.outputFormat));
  if (missing.length > 0) {
    throw new Error(
      `The deepest workflow level must emit the finding schema; missing: ${missing.join(', ')}.`,
    );
  }

  return blueprint;
}

export function parsePostScriptBlueprint(json: string): PostScriptBlueprint {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('The post-script blueprint is not valid JSON.');
  }

  const parsed = PostScriptBlueprint.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `The post-script blueprint is malformed: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'root'} ${issue.message.toLowerCase()}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

export function selectPostScriptByName(
  scripts: readonly NamedResource[],
  name: string,
): NamedResource | undefined {
  return scripts.find((script) => script.name === name);
}

export function selectWorkflowByName(
  workflows: readonly NamedResource[],
  name: string,
): NamedResource | undefined {
  return workflows.find((workflow) => workflow.name === name);
}

/**
 * Read the configured chain. Order is the operator's, because it is the order
 * the findings are enriched in and a report written before its proof of concept
 * has nothing to describe.
 */
export function parsePostScriptChain(value: string | undefined): string[] {
  const names = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return names.length > 0 ? [...new Set(names)] : [...DEFAULT_POST_SCRIPT_CHAIN];
}

/**
 * Map chain names onto the ids Open-Kritt installed. A name that is not
 * installed fails the whole chain: quietly dropping it would produce findings
 * missing exactly the proof or scope check the operator asked for.
 */
export function resolvePostScriptChain(
  installed: readonly NamedResource[],
  chain: readonly string[],
): string[] {
  if (chain.length === 0) {
    throw new Error('A post-script chain needs at least one entry; Kritt requires one per scan.');
  }

  const byName = new Map(installed.map((script) => [script.name, script.id]));
  const missing = chain.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Open-Kritt has no post-script named: ${missing.join(', ')}. ` +
        `Installed: ${installed.map((script) => script.name).join(', ') || 'none'}.`,
    );
  }

  return chain.map((name) => byName.get(name)!);
}
