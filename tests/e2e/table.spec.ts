import { expect, test, type Page } from '@playwright/test';

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

async function firstOccupiedNode(page: Page): Promise<string> {
  const row = page.getByTestId('field-occupancy').locator('li').first();
  await expect(row).toHaveCount(1, { timeout: 10_000 });
  const node = await row.getAttribute('data-node');
  if (node === null) throw new Error('occupancy row has no node');
  return node;
}

async function skipPlate(page: Page): Promise<void> {
  const end = page.getByTestId('end-turn');
  if ((await end.isVisible().catch(() => false)) && (await end.isEnabled().catch(() => false))) {
    await end.click();
  }
}

async function deployOnce(page: Page): Promise<void> {
  await skipPlate(page);
  const fig = page.locator('[data-testid^="figure-"][data-can="deploy"]:not([disabled])').first();
  await expect(fig).toBeVisible({ timeout: 8_000 });
  await fig.click();
  const dest = page.locator('[data-testid^="node-"][data-reach="1"]').first();
  await expect(dest).toBeVisible({ timeout: 4_000 });
  await dest.click();
}

async function moveOnce(page: Page): Promise<void> {
  await skipPlate(page);
  const field = page.locator('[data-testid^="node-"][data-movable="1"]').first();
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  const dest = page.locator('[data-testid^="node-"][data-reach="1"]').first();
  await expect(dest).toBeVisible({ timeout: 4_000 });
  await dest.click();
}

async function expectSameBoard(a: Page, b: Page): Promise<void> {
  await expect
    .poll(async () => {
      const left = await occupancy(a);
      const right = await occupancy(b);
      return left === right;
    })
    .toBe(true);
}

async function readyHotseat(page: Page, seed: number): Promise<void> {
  await page.goto(`/2d?seed=${String(seed)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('play-setup')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('human-seat')).toHaveCount(0);
  expect(page.url()).not.toContain('relay=');
  await page.getByTestId('use-starters').click();
  await expect(page.getByTestId('start-duel')).toBeEnabled({ timeout: 10_000 });
  await page.getByTestId('start-duel').click();
}

test('two tabs on the same seed are opposite sides, both bottom-oriented', async ({ page, context }) => {
  test.setTimeout(90_000);
  await readyHotseat(page, 2118);
  await expect(page.getByTestId('start-duel')).toBeDisabled();

  const away = await context.newPage();
  await readyHotseat(away, 2118);

  await expect(page.getByTestId('play-duel')).toBeVisible({ timeout: 30_000 });
  await expect(away.getByTestId('play-duel')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('handover')).toHaveCount(0);
  await expect(away.getByTestId('handover')).toHaveCount(0);
  await expect(page.getByTestId('play-duel')).toHaveAttribute('data-role', 'home');
  await expect(page.getByTestId('play-duel')).toHaveAttribute('data-flip', '0');
  await expect(away.getByTestId('play-duel')).toHaveAttribute('data-role', 'away');
  await expect(away.getByTestId('play-duel')).toHaveAttribute('data-flip', '1');
  await expect(away.getByTestId('play-board')).toHaveAttribute('data-flip', '1');
  await expect(page.getByTestId('play-seat-you')).toBeVisible();
  await expect(away.getByTestId('play-seat-you')).toBeVisible();

  await deployOnce(page);
  const node = await firstOccupiedNode(page);
  const homeY = Number(await page.getByTestId(`node-${node}`).getAttribute('data-y'));
  expect(homeY).toBeGreaterThan(55);
  await expect(page.locator(`[data-testid="node-${node}"][data-sprite]`)).toBeVisible();

  await expectSameBoard(away, page);
  const awayY = Number(await away.getByTestId(`node-${node}`).getAttribute('data-y'));
  expect(awayY).toBeLessThan(45);
  await expect(away.locator(`[data-testid="node-${node}"][data-sprite]`)).toBeVisible();

  await deployOnce(away);
  await expectSameBoard(page, away);
  const rows = page.getByTestId('field-occupancy').locator('li');
  await expect(rows).toHaveCount(2, { timeout: 10_000 });
  const awayNode = await rows.evaluateAll((els, homeNode) => {
    const found = els.map((el) => el.getAttribute('data-node')).find((id) => id !== null && id !== homeNode);
    return found ?? null;
  }, node);
  expect(awayNode).toBeTruthy();
  if (awayNode === null) throw new Error('missing away node');
  const awayOnHome = Number(await page.getByTestId(`node-${awayNode}`).getAttribute('data-y'));
  expect(awayOnHome).toBeLessThan(45);
  const awayOnAway = Number(await away.getByTestId(`node-${awayNode}`).getAttribute('data-y'));
  expect(awayOnAway).toBeGreaterThan(55);

  const two = await occupancy(page);
  await skipPlate(page);
  if (await page.locator('[data-testid^="figure-"][data-can="deploy"]:not([disabled])').count()) {
    await deployOnce(page);
  } else {
    await moveOnce(page);
  }
  await expect.poll(async () => occupancy(page)).not.toBe(two);
  await expectSameBoard(away, page);
  const beforeMove = await occupancy(page);
  await moveOnce(away);
  await expect.poll(async () => occupancy(page)).not.toBe(beforeMove);
  expect(page.url()).toContain('seed=2118');
  expect(page.url()).not.toContain('relay=');

  const watcher = await context.newPage();
  await watcher.goto('/2d?seed=2118', { waitUntil: 'domcontentloaded' });
  await expect(watcher.getByTestId('play-duel')).toBeVisible({ timeout: 30_000 });
  await expect(watcher.getByTestId('play-duel')).toHaveAttribute('data-role', 'spectator');
  await expect(watcher.getByTestId('table-full')).toBeVisible();
});

test('/2d vs-AI has no seat picker and keeps the human at the bottom', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/2d?seed=2116', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('play-setup')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('mode-vs-ai').check();
  await expect(page.getByTestId('human-seat')).toHaveCount(0);
  await page.getByTestId('use-starters').click();
  await page.getByTestId('start-vs-ai').click();
  await expect(page.getByTestId('play-duel')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('play-duel')).toHaveAttribute('data-mode', 'vsAi');
  await expect(page.getByTestId('play-duel')).toHaveAttribute('data-flip', '0');
  await expect(page.getByTestId('handover')).toHaveCount(0);
  await expect(page.getByTestId('play-seat-you')).toBeVisible();
  await expect(page.getByTestId('play-seat-rival')).toBeVisible();
});
