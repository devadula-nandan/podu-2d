import { expect, test, type Browser, type Page } from '@playwright/test';

const SEED = Number(process.env.PODU_ROOM_SEED ?? String((Date.now() >>> 0) ^ 0x2a110000));

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

async function openLobby(page: Page): Promise<void> {
  await page.goto(`/2d?seed=${String(SEED)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('play-setup')).toBeVisible({ timeout: 60_000 });
  expect(page.url()).toMatch(new RegExp(`/2d\\?seed=${String(SEED)}$`));
  expect(page.url()).not.toContain('relay=');
  expect(page.url()).not.toContain(':8787');
  await expect(page.getByTestId('start-duel')).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByTestId('room-offline')).toHaveCount(0);
}

test('LAN Vite URL seats two contexts and broadcasts a deploy', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(120_000);
  const c1 = await browser.newContext();
  const c2 = await browser.newContext();
  const p1 = await c1.newPage();
  const p2 = await c2.newPage();

  await openLobby(p1);
  await expect(p1.getByTestId('start-duel')).toBeEnabled();

  await openLobby(p2);
  await expect(p1.getByTestId('room-presence')).toContainText(/Rival here|Rival ready/, {
    timeout: 10_000,
  });
  await expect(p2.getByTestId('room-presence')).toContainText(/You/);
  await expect(p1.getByTestId('room-offline')).toHaveCount(0);
  await expect(p2.getByTestId('room-offline')).toHaveCount(0);

  await p1.getByTestId('use-starters').click();
  await p1.getByTestId('start-duel').click();
  await p2.getByTestId('use-starters').click();
  await p2.getByTestId('start-duel').click();

  await expect(p1.getByTestId('play-duel')).toBeVisible({ timeout: 30_000 });
  await expect(p2.getByTestId('play-duel')).toBeVisible({ timeout: 30_000 });
  await expect(p1.getByTestId('play-duel')).toHaveAttribute('data-role', 'home');
  await expect(p2.getByTestId('play-duel')).toHaveAttribute('data-role', 'away');
  expect(p1.url()).not.toContain('relay=');
  expect(p2.url()).not.toContain('relay=');

  await deployOnce(p1);
  await expect.poll(async () => (await occupancy(p2)) === (await occupancy(p1))).toBe(true);

  await c1.close();
  await c2.close();
});
