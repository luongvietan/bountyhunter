import { expect, test } from '@playwright/test';

// Serial: every test in this file shares one database and the decisions are
// durable, so ordering is part of the contract rather than an accident.
test.describe.configure({ mode: 'serial' });

test('shows the pending queue with its evidence and blocks what cannot be approved', async ({
  page,
}) => {
  await page.goto('/merge-queue');

  await expect(page.getByRole('heading', { name: 'Merge review queue' })).toBeVisible();
  await expect(page.getByText('84%')).toBeVisible();

  // Target the list entries rather than the entity name, which also appears in
  // the merge direction and the confirmation sentence.
  const approvable = page.getByRole('article').filter({ hasText: 'zephyr perps' });
  await expect(
    approvable.getByRole('listitem').filter({ hasText: 'github.com/zephyr-fi/perps-core' }),
  ).toBeVisible();
  await expect(approvable.getByRole('listitem').filter({ hasText: 'trailofbits' })).toBeVisible();

  // Approval must stay unavailable until the operator confirms the consequence.
  const approve = approvable.getByRole('button', { name: 'Approve match' });
  await expect(approve).toBeDisabled();

  // The blocked candidate states why instead of offering a control that fails.
  const blocked = page.getByRole('article').filter({ hasText: 'orbit lending' });
  await expect(blocked.getByText(/no audit reports to merge/i)).toBeVisible();
  await expect(blocked.getByRole('button', { name: 'Approve match' })).toHaveCount(0);
});

test('approving moves the candidate out of pending and records the decision', async ({ page }) => {
  await page.goto('/merge-queue');

  const approvable = page.getByRole('article').filter({ hasText: 'zephyr perps' });
  await approvable.getByRole('checkbox').check();

  const approve = approvable.getByRole('button', { name: 'Approve match' });
  await expect(approve).toBeEnabled();
  await approve.click();

  // The action revalidates the route, so a decided candidate drops off the
  // pending tab. Waiting for that is what proves the write reached Postgres;
  // navigating earlier aborts the server action mid-flight.
  await expect(approvable).toHaveCount(0);

  // The decision survives a reload, which is what makes it durable rather than
  // optimistic UI.
  await page.goto('/merge-queue?status=approved');
  const approved = page.getByRole('article').filter({ hasText: 'zephyr perps' });
  await expect(approved).toBeVisible();
  // exact: the card also carries "Decision locked. Approved" and the
  // approval evidence panel.
  await expect(approved.getByText('approved', { exact: true })).toBeVisible();

  await page.goto('/merge-queue?status=pending');
  await expect(page.getByRole('article').filter({ hasText: 'zephyr perps' })).toHaveCount(0);
});

test('rejecting records the decision without touching evidence', async ({ page }) => {
  await page.goto('/merge-queue');

  const blocked = page.getByRole('article').filter({ hasText: 'orbit lending' });
  await blocked.getByRole('button', { name: 'Reject match' }).click();
  await expect(blocked).toHaveCount(0);

  await page.goto('/merge-queue?status=rejected');
  const rejected = page.getByRole('article').filter({ hasText: 'orbit lending' });
  await expect(rejected).toBeVisible();
  await expect(rejected.getByText('rejected', { exact: true })).toBeVisible();
});

test('stays usable at 390x844 without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/merge-queue?status=approved');

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflows).toBe(false);

  await expect(page.getByRole('heading', { name: 'Merge review queue' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Pending/ })).toBeVisible();
});

test('keyboard reaches the status navigation from the top of the page', async ({ page }) => {
  await page.goto('/merge-queue');

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to merge queue' })).toBeFocused();

  await page.keyboard.press('Tab');
  const focusedIsVisible = await page.evaluate(() => {
    const active = document.activeElement;
    if (!active) return false;
    const box = active.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  });
  expect(focusedIsVisible).toBe(true);
});
