import { expect, test, type Page } from '@playwright/test';

async function confirmHandover(page: Page): Promise<void> {
  const handoff = page.getByTestId('handover-confirm');
  try {
    await handoff.waitFor({ state: 'visible', timeout: 500 });
    await handoff.click();
  } catch {
    /* no hand-off this step */
  }
}

async function occupancy(page: Page): Promise<string> {
  const items = page.getByTestId('field-occupancy').locator('li');
  await expect(items).not.toHaveCount(0, { timeout: 10_000 });
  const rows = await items.all();
  const parts: string[] = [];
  for (const row of rows) {
    const id = await row.getAttribute('data-testid');
    const node = await row.getAttribute('data-node');
    parts.push(`${id ?? ''}@${node ?? ''}`);
  }
  return parts.sort().join('|');
}

test('one live duel is shared across /3d and /dev', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/3d?seed=2113', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('play-setup')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('seed-input')).toHaveValue('2113');
  await page.getByTestId('mode-vs-ai').check();
  await page.getByTestId('deck-slot-load-0').click();
  await page.getByTestId('start-vs-ai').click();
  await expect(page.getByTestId('play-duel').or(page.getByTestId('handover'))).toBeVisible({
    timeout: 30_000,
  });
  await confirmHandover(page);
  await expect(page.getByTestId('play-duel')).toBeVisible();

  const deploy = page.locator('[data-testid^="figure-"][data-can="deploy"]').first();
  await expect(deploy).toBeVisible();
  await deploy.click();
  const dest = page.locator('[data-testid^="node-"][data-reach="1"]').first();
  await expect(dest).toBeVisible({ timeout: 4_000 });
  await dest.click();
  await confirmHandover(page);

  const afterDeploy = await occupancy(page);
  expect(afterDeploy.length).toBeGreaterThan(0);
  await expect(page).toHaveURL(/\/3d\?seed=2113/);
  await expect(page.getByTestId('play-seed')).toContainText('0x00000841');

  await page.getByRole('link', { name: 'Dev' }).click();
  await expect(page).toHaveURL(/\/dev\?seed=2113/);
  await expect(page.getByTestId('deck-builder')).toHaveCount(0);
  await expect(page.getByTestId('duel')).toBeVisible({ timeout: 15_000 });
  await confirmHandover(page);
  await expect(page.getByTestId('duel')).toBeVisible();
  await expect(page.getByTestId('seed')).toContainText('0x00000841');
  expect(await occupancy(page)).toBe(afterDeploy);

  await confirmHandover(page);
  if (await page.getByTestId('skip-plate').isVisible().catch(() => false)) {
    await page.getByTestId('skip-plate').click();
    await confirmHandover(page);
  } else if (
    (await page.getByTestId('end-turn').isVisible().catch(() => false)) &&
    (await page.getByTestId('end-turn').isEnabled().catch(() => false))
  ) {
    await page.getByTestId('end-turn').click();
    await confirmHandover(page);
  }
  if (!(await page.getByTestId('legal-moves').isVisible().catch(() => false))) {
    await page.getByTestId('dev-tab-commands').click();
  }
  const move = page.locator('[data-testid="legal-moves"] button').filter({ hasText: /^Move / }).first();
  if ((await move.count()) === 0) {
    const deployAgain = page.locator('[data-testid="legal-moves"] button').filter({ hasText: /^Deploy / }).first();
    await expect(deployAgain).toBeVisible({ timeout: 8_000 });
    await deployAgain.click();
    await confirmHandover(page);
  } else {
    await move.click();
    await confirmHandover(page);
  }

  const afterMove = await occupancy(page);
  expect(afterMove).not.toBe(afterDeploy);

  await page.getByTestId('dev-to-3d').click();
  await expect(page).toHaveURL(/\/3d\?seed=2113/);
  await expect(page.getByTestId('play-duel').or(page.getByTestId('handover'))).toBeVisible({
    timeout: 15_000,
  });
  await confirmHandover(page);
  expect(await occupancy(page)).toBe(afterMove);

  await page.getByRole('link', { name: 'Dev' }).click();
  await expect(page).toHaveURL(/\/dev\?seed=2113/);
  await expect(page.getByTestId('duel').or(page.getByTestId('handover'))).toBeVisible();
  expect(await occupancy(page)).toBe(afterMove);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/dev\?seed=2113/);
  await expect(page.getByTestId('duel').or(page.getByTestId('handover'))).toBeVisible({
    timeout: 30_000,
  });
  await confirmHandover(page);
  expect(await occupancy(page)).toBe(afterMove);

  const shared = await page.evaluate(() => window.location.href);
  expect(shared).toMatch(/\/dev\?seed=2113/);
});
