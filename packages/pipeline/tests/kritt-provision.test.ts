import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POST_SCRIPT_CHAIN,
  parseWorkflowBlueprint,
  parsePostScriptChain,
  resolvePostScriptChain,
  selectWorkflowByName,
} from '../src/kritt-provision.js';

const blueprint = {
  name: 'Solidity DeFi Value Flow',
  description: 'Traces on-chain value movement.',
  levels: [
    {
      depth: 0,
      multiOutput: true,
      outputFormat: { sol_entry_contract: 'string' },
      steps: [{ name: 'Enumerate', content: 'Look at {{repo_full}}.' }],
    },
    {
      depth: 1,
      multiOutput: true,
      outputFormat: {
        summary: 'string',
        explanation: 'string',
        file_path: 'string',
        line: 'number',
        vulnerability_type: 'string',
        malicious_actor: 'string',
        malicious_input_example: 'string',
        trigger_flow: 'array',
      },
      steps: [{ name: 'Investigate', content: 'Check {{sol_entry_contract}}.' }],
    },
  ],
};

describe('parseWorkflowBlueprint', () => {
  it('accepts a blueprint whose terminal depth emits the finding schema', () => {
    expect(parseWorkflowBlueprint(JSON.stringify(blueprint)).name).toBe('Solidity DeFi Value Flow');
  });

  it('rejects a blueprint whose deepest level omits a required finding key', () => {
    const broken = structuredClone(blueprint);
    delete (broken.levels[1].outputFormat as Record<string, string>).trigger_flow;
    expect(() => parseWorkflowBlueprint(JSON.stringify(broken))).toThrow(/trigger_flow/);
  });

  it('rejects depths that do not start at zero and run contiguously', () => {
    const broken = structuredClone(blueprint);
    broken.levels[1].depth = 3;
    expect(() => parseWorkflowBlueprint(JSON.stringify(broken))).toThrow(/contiguous/i);
  });

  it('reports the file as unreadable rather than throwing a JSON parser message', () => {
    expect(() => parseWorkflowBlueprint('{ not json')).toThrow(/not valid JSON/i);
  });
});

describe('selectWorkflowByName', () => {
  it('matches on exact name so a rename does not silently reuse the wrong prompt', () => {
    const found = selectWorkflowByName(
      [
        { id: '1', name: 'external-flow-analysis' },
        { id: '7', name: 'Solidity DeFi Value Flow' },
      ],
      'Solidity DeFi Value Flow',
    );
    expect(found?.id).toBe('7');
  });

  it('returns undefined when nothing matches', () => {
    expect(selectWorkflowByName([{ id: '1', name: 'other' }], 'Solidity DeFi Value Flow')).toBeUndefined();
  });
});

describe('parsePostScriptChain', () => {
  it('splits a comma separated list and trims each name', () => {
    expect(parsePostScriptChain(' PoC Creator , Report Creator ')).toEqual([
      'PoC Creator',
      'Report Creator',
    ]);
  });

  it('falls back to the bundled chain when the setting is empty', () => {
    expect(parsePostScriptChain('')).toEqual([...DEFAULT_POST_SCRIPT_CHAIN]);
    expect(parsePostScriptChain(undefined)).toEqual([...DEFAULT_POST_SCRIPT_CHAIN]);
  });

  it('keeps the operator order and drops repeats', () => {
    expect(parsePostScriptChain('Report Creator,PoC Creator,Report Creator')).toEqual([
      'Report Creator',
      'PoC Creator',
    ]);
  });
});

const installed = [
  { id: '3', name: 'Report Creator' },
  { id: '9', name: 'Is Malicious Actor in scope' },
  { id: '5', name: 'PoC Creator' },
];

describe('resolvePostScriptChain', () => {
  it('returns ids in the order the chain names them, not the order Kritt lists them', () => {
    expect(
      resolvePostScriptChain(installed, ['PoC Creator', 'Report Creator', 'Is Malicious Actor in scope']),
    ).toEqual(['5', '3', '9']);
  });

  it('names every missing post-script instead of silently running a shorter chain', () => {
    expect(() => resolvePostScriptChain(installed, ['PoC Creator', 'Patched since', 'Nope'])).toThrow(
      /Patched since, Nope/,
    );
  });

  it('refuses an empty chain, because Kritt requires at least one post-script', () => {
    expect(() => resolvePostScriptChain(installed, [])).toThrow(/at least one/i);
  });
});
