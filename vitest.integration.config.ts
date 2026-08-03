import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) => resolve(import.meta.dirname, `packages/${name}/src/index.ts`);

export default defineConfig({
  resolve: {
    alias: {
      '@kritt-radar/core': pkg('core'),
      '@kritt-radar/collectors': pkg('collectors'),
      '@kritt-radar/db': pkg('db'),
      '@kritt-radar/pipeline': pkg('pipeline'),
    },
  },
  test: {
    include: ['apps/**/tests/**/*.integration.test.ts'],
    environment: 'node',
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
