import { expect, test, type Browser, type Page } from '@playwright/test';

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

async function actOnce(page: Page): Promise<void> {
  await skipPlate(page);
  const deploy = page.locator('[data-testid^="figure-"][data-can="deploy"]:not([disabled])').first();
  if ((await deploy.count()) > 0) {
    await deploy.click();
    const dest = page.locator('[data-testid^="node-"][data-reach="1"]').first();
    await expect(dest).toBeVisible({ timeout: 4_000 });
    await dest.click();
    return;
  }
  const field = page.locator('[data-testid^="node-"][data-movable="1"]').first();
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  const dest = page.locator('[data-testid^="node-"][data-reach="1"]').first();
  await expect(dest).toBeVisible({ timeout: 4_000 });
  await dest.click();
}

async function openAndReady(page: Page): Promise<void> {
  await page.goto('/3d?seed=4242', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('play-setup')).toBeVisible({ timeout: 60_000 });
  expect(page.url()).not.toContain('relay=');
  await expect(page.getByTestId('network-invite-url')).toHaveText(/\/3d\?seed=4242$/);
  await page.getByTestId('deck-slot-load-0').click();
  await expect(page.getByTestId('start-duel')).toBeEnabled({ timeout: 10_000 });
  await page.getByTestId('start-duel').click();
}

test('two contexts share seed 4242, reclaim a vacant seat, and reject a third player', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(120_000);
  const c1 = await browser.newContext();
  const c2 = await browser.newContext();
  const p1 = await c1.newPage();
  const p2 = await c2.newPage();

  await openAndReady(p1);
  await openAndReady(p2);

  await expect(p1.getByTestId('play-duel')).toBeVisible({ timeout: 30_000 });
  await expect(p2.getByTestId('play-duel')).toBeVisible({ timeout: 30_000 });
  await expect(p1.getByTestId('play-duel')).toHaveAttribute('data-role', 'home');
  await expect(p1.getByTestId('play-duel')).toHaveAttribute('data-flip', '0');
  await expect(p2.getByTestId('play-duel')).toHaveAttribute('data-role', 'away');
  await expect(p2.getByTestId('play-duel')).toHaveAttribute('data-flip', '1');
  await expect(p1.getByTestId('play-seat-you')).toBeVisible();
  await expect(p2.getByTestId('play-seat-you')).toBeVisible();
  await expect(p1.getByTestId('play-seat-rival')).toBeVisible();
  expect(p1.url()).not.toContain('relay=');
  expect(p2.url()).not.toContain('relay=');

  await deployOnce(p1);
  await expect
    .poll(async () => (await occupancy(p2)) === (await occupancy(p1)))
    .toBe(true);
  const node = await p1.getByTestId('field-occupancy').locator('li').first().getAttribute('data-node');
  expect(node).toBeTruthy();
  if (node !== null) {
    const y2 = Number(await p2.getByTestId(`node-${node}`).getAttribute('data-y'));
    expect(y2).toBeLessThan(45);
  }

  const board = await occupancy(p1);
  await c1.close();

  const c3 = await browser.newContext();
  const p3 = await c3.newPage();
  await p3.goto('/3d?seed=4242', { waitUntil: 'domcontentloaded' });
  await expect(p3.getByTestId('play-duel')).toBeVisible({ timeout: 30_000 });
  await expect(p3.getByTestId('play-duel')).toHaveAttribute('data-role', 'home');
  await expect.poll(async () => occupancy(p3)).toBe(board);
  await expect(p3.getByTestId('play-seat-you')).toBeVisible();

  const p3CanAct = async (): Promise<boolean> =>
    (await p3.locator('[data-testid^="figure-"][data-can="deploy"]:not([disabled])').count()) > 0 ||
    (await p3.locator('[data-testid^="node-"][data-movable="1"]').count()) > 0 ||
    (await p3.getByTestId('end-turn').isEnabled().catch(() => false));

  if (!(await p3CanAct())) {
    await actOnce(p2);
    await expect
      .poll(async () => {
        const left = await occupancy(p2);
        const right = await occupancy(p3);
        return left === right && left !== board;
      })
      .toBe(true);
  }
  await actOnce(p3);
  await expect
    .poll(async () => (await occupancy(p2)) === (await occupancy(p3)))
    .toBe(true);

  const c4 = await browser.newContext();
  const p4 = await c4.newPage();
  await p4.goto('/3d?seed=4242', { waitUntil: 'domcontentloaded' });
  await expect(p4.getByTestId('play-duel')).toBeVisible({ timeout: 30_000 });
  await expect(p4.getByTestId('play-duel')).toHaveAttribute('data-role', 'spectator');
  await expect(p4.getByTestId('table-full')).toBeVisible();
  expect(p4.url()).not.toContain('relay=');

  await c2.close();
  await c3.close();
  await c4.close();
});
