import { resolve } from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

const pkg = (name: string) => resolve(import.meta.dirname, `packages/${name}/src/index.ts`);

export default defineConfig({
  resolve: {
    // Trỏ thẳng vào src: package.json khai `main: dist/index.js`, mà test chạy
    // trên nguồn TypeScript nên không muốn phải build trước mỗi lần chạy test.
    alias: {
      '@kritt-radar/core': pkg('core'),
      '@kritt-radar/collectors': pkg('collectors'),
      '@kritt-radar/db': pkg('db'),
      '@kritt-radar/pipeline': pkg('pipeline'),
    },
  },
  test: {
    include: ['packages/**/tests/**/*.test.ts', 'apps/**/tests/**/*.test.ts'],
    // Playwright specs need a browser and a live server; excluded explicitly so
    // a future rename cannot quietly pull them into the unit run.
    exclude: [...configDefaults.exclude, '**/*.integration.test.ts', '**/*.e2e.spec.ts'],
    environment: 'node',
  },
});
