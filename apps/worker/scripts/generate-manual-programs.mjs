/**
 * One-shot generator for config/manual-programs.yml.
 * Run: node apps/worker/scripts/generate-manual-programs.mjs
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeRepoUrl } from '@kritt-radar/core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SLUGS = [
  'gmx',
  'beefyfinance',
  'hyperlane',
  'parallel',
  'metronome',
  'debridge',
  'ondofinance',
  'enzymefinance',
  'compoundfinance',
  'sparklend',
];

/** Repo keys Immunefi mirror/API miss because assets are mostly contract addresses. */
const CURATED = {
  gmx: {
    orgs: ['gmx-io'],
    include: /.*/,
    exclude: /interface|subgraph|stats|integration-api|share-api|gmx-ai/i,
  },
  beefyfinance: {
    orgs: ['beefyfinance'],
    include: /^beefy-|address-book|staking|moonpot/i,
    exclude: /app$|landing|blog|dashboard|db-dev|databarn|bi$|moobird|lottery|moderator|starter-pack|slither|whitehat|dot-com|investor-api|onboard-api|balances-api|balances-subgraph|envio-balances|lrt-api|lrt-hyperindex|snap-cache|vote-api|vote-strategies|position-adjuster|renzo-points|bsc-allowance|ethers-multicall|error-selectors/i,
  },
  hyperlane: {
    orgs: ['hyperlane-xyz'],
    include: /hyperlane|fuel-contracts|cosmwasm|^solana$|xerc20|superchain|solidity|^core$/i,
    exclude: /fork|sandbox|gameboy|quickstart|awesome|hips$|specs$|metadata-mainnet|joe-tokenlists|coingecko|cometbft|tendermint|ethers-rs|parity-common|burners|aw-registry|avs-metadata|community-isms|agent-sandbox|Hackathon|starterkit|Aave-Vault|ERCs$|celo-ethers|supersim|starkli|shank|runner$|rewards$|universal-router|hypermint|deploy-app|content$|monorepo-ai|monorepo-zksync|radix|tracer|fuels-rs|fuel-indexer|aleo$|starknet$|nft$|nfts$/i,
  },
  parallel: {
    orgs: ['parallel-protocol'],
    include: /.*/,
    exclude: /brand-kit|kyberswap|peggedassets-server|yield-server|snapshot-strategies|DefiLlama/i,
  },
  metronome: {
    repos: [
      'github.com/autonomoussoftware/metronome-synth-public',
      'github.com/autonomoussoftware/metronome',
      'github.com/autonomoussoftware/metronome-contracts-js',
      'github.com/autonomoussoftware/metronome-wallet-core',
    ],
  },
  debridge: {
    orgs: ['debridge-finance'],
    include: /debridge|dln-|multibridge|hardhat-debridge|desdk|validator|solana-sdk|anchor/i,
    exclude: /challenge|poc|embezzler|widget-react|CoinGecko|mev-job|liquality|safe-transaction|metaplex|rig-onchain|solana-agent|test-|missing-|deploy-safe|denft|goat$|strum$|tracing-|data-engineer|node-challenge|api-integrator|bridges-server|abis-and-idls|agave|anchor-build|jupiter-cpi|list-validators|meta-aggregation|multisig-evm|sbpf|solana-program-library|solana-tx-parser|ts-anchor-fork|uniswap-multibridge|evm-sol-serializer|debridge-arweave|debridge-launcher|debridge-mcp|debridge-skills|debridge-u256|debridge_anchor_extensions|de-solana-client|denft|missing-solana|test-merkle|test-send-method/i,
  },
  ondofinance: {
    orgs: ['ondoprotocol'],
    include: /.*/,
    exclude: /DefiLlama|defillama-server|peggedassets-server|yield-server|external-adapters-js|mmi-defi-adapters|gm-solana-simulator|aptos-coin-list|default-token-list-camelot|ondo-global-markets-token-list/i,
  },
  enzymefinance: {
    orgs: ['enzymefinance'],
    include: /protocol|melon|mfp|spec|security|onyx|substreams/i,
    exclude: /app$|docs|sdk|hackathon|paper|oyente|enzip|gsn-trusted/i,
  },
  compoundfinance: {
    orgs: ['compound-finance'],
    include: /compound|comet|open-oracle|encumber|gateway|quark|autonomous-proposals|open-oracle|tokens$|token-list|compound-js|compound-config|compound-governance|compound-money-market|compound-protocol|compound-eureka|compound-components|compound-styles|comp\.vote|quickborrow|quest$|sleuth|saddle|palisade|circlex|cip-pm|abi$|hardhat-cover|foundry$|solidity-coverage|solidity-parser|webb3|vote-1|money-market-lite|protocol-lite/i,
    exclude: /bitcoin|cairo|libra|polkadot|substrate|tezos|cosmos|cumulus|ethereumjs|ganache|test-reporter|github-action|cloud-builders|0x-monorepo|EIPs$|crypto-fees|erlang|eth-contract-metadata|ethabi|ethereumex|etherscan|ledger-asset|mana$|polygon-token|redis|redix|rust-cache|snappyer|autonomous-proposals-lite/i,
  },
  sparklend: {
    orgs: ['sparkdotfi', 'marsfoundation'],
    include: /.*/,
    exclude: /dev-docs$|spark-docs$|sparkie$|checklist|user-actions$|utilities$|spell-caster|airdrop-recipients|xlayer-deployment|pau-deploy|boosted-vault|hyperlane-warp|permissionless-withdrawals|sky-spells|mainnet-invariants|erc20-helpers$|aave-cli$|aave-helpers$|V2-V3-migration|\.github$/i,
  },
};

function isLikelyAuditRepo(repo) {
  return /guardianaudits|trailofbits|openzeppelin|publications|\/audits$/i.test(repo);
}

function githubFromValue(value, out) {
  if (value == null) return;
  if (typeof value === 'string') {
    for (const hit of value.match(/https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/g) ?? []) {
      const key = normalizeRepoUrl(hit.split('#')[0]);
      if (key) out.add(key);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) githubFromValue(item, out);
    return;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) githubFromValue(v, out);
  }
}

async function orgRepos(org, token) {
  const repos = [];
  for (let page = 1; page <= 5; page += 1) {
    const response = await fetch(
      `https://api.github.com/orgs/${org}/repos?per_page=100&page=${page}&type=public`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    if (!response.ok) break;
    const batch = await response.json();
    if (!batch.length) break;
    repos.push(...batch.map((repo) => `github.com/${repo.full_name}`));
  }
  return repos;
}

function filterRepos(repos, include, exclude) {
  return repos.filter((repo) => {
    const name = repo.split('/').pop() ?? '';
    if (exclude && exclude.test(name)) return false;
    if (include && !include.test(name)) return false;
    return true;
  });
}

const token = process.env.GITHUB_TOKEN;
const apiPrograms = await fetch('https://immunefi.com/public-api/bounties.json').then((r) => r.json());
const mirrorPrograms = await fetch(
  'https://raw.githubusercontent.com/infosec-us-team/Immunefi-Bug-Bounty-Programs-Unofficial/main/projects.json',
).then((r) => r.json());

const output = {};
let totalRepos = 0;

for (const slug of SLUGS) {
  const api = apiPrograms.find((p) => p.slug === slug);
  const mirror = mirrorPrograms.find((p) => p.slug === slug);
  if (!api) {
    console.warn(`skip ${slug}: not in Immunefi API`);
    continue;
  }

  const repos = new Set();
  githubFromValue(api, repos);
  if (api.githubUrl) {
    const key = normalizeRepoUrl(api.githubUrl);
    if (key) repos.add(key);
  }
  for (const asset of mirror?.assets ?? []) {
    const key = normalizeRepoUrl(String(asset.url ?? ''));
    if (key) repos.add(key);
  }

  const curated = CURATED[slug];
  if (curated?.repos) {
    for (const repo of curated.repos) repos.add(repo);
  }
  if (curated?.orgs) {
    for (const org of curated.orgs) {
      const orgList = await orgRepos(org, token);
      for (const repo of filterRepos(orgList, curated.include, curated.exclude)) {
        repos.add(repo);
      }
    }
  }

  const repoList = [...repos].filter((repo) => !isLikelyAuditRepo(repo)).sort();
  totalRepos += repoList.length;
  output[slug] = {
    platform: 'immunefi',
    externalId: slug,
    title: api.project,
    url: `https://immunefi.com/bounty/${slug}/`,
    poolUsd: api.rewardsPool > 0 ? api.rewardsPool : api.maxBounty > 0 ? api.maxBounty : null,
    repos: repoList,
  };
  console.log(`${slug}: ${repoList.length} repos`);
}

function toYaml(data) {
  const lines = [
    '# Immunefi programs whose mirror assets are mostly contract addresses.',
    '# Repo lists are curated from Immunefi metadata plus GitHub org inventories.',
    '',
  ];
  for (const [slug, entry] of Object.entries(data)) {
    lines.push(`${slug}:`);
    lines.push(`  platform: ${entry.platform}`);
    lines.push(`  externalId: ${entry.externalId}`);
    lines.push(`  title: ${JSON.stringify(entry.title)}`);
    lines.push(`  url: ${entry.url}`);
    if (entry.poolUsd != null) lines.push(`  poolUsd: ${entry.poolUsd}`);
    lines.push('  repos:');
    for (const repo of entry.repos) lines.push(`    - ${repo}`);
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}
writeFileSync(resolve(ROOT, 'config/manual-programs.yml'), toYaml(output), 'utf8');
console.log(`\nWrote ${totalRepos} repos across ${Object.keys(output).length} programs`);
