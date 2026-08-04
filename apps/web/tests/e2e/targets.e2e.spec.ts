import { expect, test } from '@playwright/test';
import { SEED } from './seed';

test.describe.configure({ mode: 'serial' });

test('shows ranked targets with measured gap evidence and console navigation', async ({ page }) => {
  await page.goto('/targets');

  await expect(page.getByRole('heading', { name: 'Target ranking' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Targets' })).toHaveAttribute('aria-current', 'page');

  const zephyr = page.getByRole('link', { name: SEED.repoKey });
  await expect(zephyr).toBeVisible();
  const zephyrRow = page.locator('.target-row').filter({ has: zephyr });
  await expect(zephyrRow.getByText('Zephyr Perps')).toBeVisible();
  await expect(zephyrRow.getByText('Audit gap', { exact: true })).toBeVisible();

  // Highest measured score should lead the list.
  const firstRepo = page.locator('.target-row:not(.target-head)').first();
  await expect(firstRepo.getByRole('link', { name: SEED.repoKey })).toBeVisible();
});

test('platform filter narrows repositories to one platform', async ({ page }) => {
  await page.goto('/targets?platform=sherlock');

  await expect(page.getByRole('link', { name: SEED.sherlockRepoKey })).toBeVisible();
  await expect(page.getByRole('link', { name: SEED.repoKey })).toHaveCount(0);
  await expect(page.getByText('Showing 1 of 3 repositories')).toBeVisible();
});

test('measured-only filter hides assumed audit gaps', async ({ page }) => {
  await page.goto('/targets?measured=1');

  await expect(page.getByRole('link', { name: SEED.repoKey })).toBeVisible();
  await expect(page.getByRole('link', { name: SEED.sherlockRepoKey })).toBeVisible();
  await expect(page.getByRole('link', { name: 'github.com/orbit-fi/lending' })).toHaveCount(0);
  await expect(page.getByText('No audit found')).toHaveCount(0);
});

test('detail page exposes the Open-Kritt handoff and copy control', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/targets/${SEED.measuredScopeId}`);

  await expect(page.getByRole('heading', { name: SEED.repoKey })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hand over to Open-Kritt' })).toBeVisible();

  const handoff = page.getByRole('textbox', { name: 'Changed files since the last audit' });
  await expect(handoff).toHaveValue('src/Pool.sol\nsrc/Router.sol');
  await expect(page.getByText(`@ ${SEED.headCommit.slice(0, 12)}`)).toBeVisible();

  await page.getByRole('button', { name: 'Copy file list' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
});

test('stays usable at 390x844 and links across console sections', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/targets');

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflows).toBe(false);

  await page.getByRole('navigation', { name: 'Console sections' }).getByRole('link', { name: 'Merge queue' }).click();
  await expect(page.getByRole('heading', { name: 'Merge review queue' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Console sections' }).getByRole('link', { name: 'Merge queue' }),
  ).toHaveAttribute('aria-current', 'page');
});
