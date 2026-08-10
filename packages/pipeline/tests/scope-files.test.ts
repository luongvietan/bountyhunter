import { describe, expect, it } from 'vitest';
import {
  buildRepoScope,
  scopeConfiguration,
  selectScopeFiles,
} from '../src/scope-files.js';

describe('selectScopeFiles', () => {
  it('prioritizes contracts, src, and solidity paths', () => {
    const selected = selectScopeFiles(
      [
        'README.md',
        'src/Vault.sol',
        'contracts/Token.sol',
        'lib/openzeppelin/ERC20.sol',
        'scripts/deploy.ts',
      ],
      { limit: 3 },
    );
    expect(selected).toEqual(['contracts/Token.sol', 'lib/openzeppelin/ERC20.sol', 'src/Vault.sol']);
  });

  it('deduplicates and respects the limit', () => {
    const files = ['a.sol', 'a.sol', 'b.sol', 'c.sol'];
    expect(selectScopeFiles(files, { limit: 2 })).toEqual(['a.sol', 'b.sol']);
  });
});

describe('buildRepoScope', () => {
  it('lists selected paths and notes truncation', () => {
    const scope = buildRepoScope(['contracts/A.sol'], 12);
    expect(scope).toContain('Only analyze these paths');
    expect(scope).toContain('- contracts/A.sol');
    expect(scope).toContain('Showing 1 of 12');
  });
});

describe('scopeConfiguration', () => {
  it('mirrors selected files in configuration', () => {
    expect(scopeConfiguration(['a.sol', 'b.sol'], 40)).toEqual({
      max_files: 40,
      scope_files: ['a.sol', 'b.sol'],
    });
  });
});
