import { expect, test } from '@playwright/test';

// Serial: the create-outcome test appends a durable row that the correlation
// assertions in the same file depend on, so ordering is part of the contract.
test.describe.configure({ mode: 'serial' });

test('shows the outcomes console with recorded history and payout correlation', async ({ page }) => {
  await page.goto('/outcomes');

  await expect(page.getByRole('navigation', { name: 'Console sections' })).toContainText('Outcomes');
  await expect(page.getByRole('link', { name: 'Outcomes' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: /outcomes/i })).toBeVisible();

  // The five seeded rows on the Zephyr Perps scope, newest first.
  const history = page.getByRole('table').filter({ has: page.getByText('Submitted') });
  await expect(history.getByRole('row')).toHaveCount(6); // header + 5 outcomes
  await expect(history.getByText('Largest payout to date.')).toBeVisible();
  await expect(history.getByText('$63,000')).toBeVisible();
  await expect(history.getByText('duplicate', { exact: true })).toBeVisible();

  // audit_gap has a snapshot on every seeded row (n=5) and clears the floor,
  // so its card must not carry the insufficient-samples banner.
  const auditGapCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Audit gap' }) });
  await expect(auditGapCard.getByText('n=5')).toBeVisible();
  await expect(auditGapCard.getByText(/insufficient samples/i)).toHaveCount(0);

  // freshness only appears on three of the five rows, so it stays unstable.
  const freshnessCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Freshness' }) });
  await expect(freshnessCard.getByText('n=3')).toBeVisible();
  await expect(freshnessCard.getByText(/insufficient samples/i)).toBeVisible();
});

test('the duplicate filter narrows the history to its own result', async ({ page }) => {
  await page.goto('/outcomes?result=duplicate');

  const history = page.getByRole('table').filter({ has: page.getByText('Submitted') });
  await expect(history.getByRole('row')).toHaveCount(2); // header + 1 duplicate
  await expect(history.getByText('$5,000')).toBeVisible();
  await expect(history.getByText('Largest payout to date.')).toHaveCount(0);
});

test('recording an outcome appends the row and grows the correlation sample', async ({ page }) => {
  await page.goto('/outcomes');

  await page.getByRole('combobox', { name: 'Scope' }).selectOption({ label: 'Zephyr Perps · immunefi' });
  await page.getByRole('combobox', { name: 'Action' }).selectOption('submit');
  await page.getByRole('combobox', { name: 'Result' }).selectOption('accepted');
  await page.getByLabel('Submitted at').fill('2026-07-26T10:00');
  await page.getByLabel('Payout (USD)').fill('99000');
  await page.getByLabel('Notes').fill('Recorded via e2e test');

  await page.getByRole('button', { name: 'Record outcome' }).click();

  // The action revalidates the route; waiting for the status message proves
  // the write reached Postgres instead of racing an optimistic render.
  await expect(page.getByRole('status')).toHaveText('Outcome recorded.');

  const history = page.getByRole('table').filter({ has: page.getByText('Submitted') });
  await expect(history.getByText('Recorded via e2e test')).toBeVisible();
  await expect(history.getByText('$99,000')).toBeVisible();
  await expect(history.getByRole('row')).toHaveCount(7); // header + 5 seeded + this one

  // The new row's snapshot comes from the scope's live audit_gap signal
  // (confidence 0.7, above the 0.3 floor), so the sample grows from 5 to 6.
  const auditGapCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Audit gap' }) });
  await expect(auditGapCard.getByText('n=6')).toBeVisible();

  // The decision survives a reload, proving it is durable rather than
  // client-side optimistic state.
  await page.goto('/outcomes');
  await expect(page.getByText('Recorded via e2e test')).toBeVisible();
});
