import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
import { E2E_BASE_URL, E2E_DATABASE_URL, E2E_PORT } from './tests/e2e/database';

const workspaceRoot = resolve(import.meta.dirname, '../..');

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.spec.ts',
  // The suite mutates one shared database, so decisions must not race.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  // No globalSetup: Playwright starts webServer first, so database preparation
  // has to happen inside the server command or Next boots against a database
  // that does not exist yet.
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    baseURL: E2E_BASE_URL,
    // Artifacts only when something failed; a green run leaves nothing behind.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Prepare then serve, in one command, so the database always exists before
    // Next creates its Prisma client. Port 3101, not the 3100 a local
    // `pnpm dev` uses: a suite that fails whenever a dev server is open is a
    // suite people stop running.
    command: `pnpm --filter @kritt-radar/web exec tsx tests/e2e/prepare.ts && pnpm --filter @kritt-radar/web start --port ${E2E_PORT} --hostname 127.0.0.1`,
    cwd: workspaceRoot,
    url: E2E_BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    // Surface server-side errors in the test output: a failed server component
    // renders as a generic error page, and without this the only symptom is a
    // missing element.
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
  },
});
