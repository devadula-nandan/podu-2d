import { expect, test, type Page } from '@playwright/test';

async function documentScrolls(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return root.scrollHeight > root.clientHeight + 1 || body.scrollHeight > body.clientHeight + 1;
  });
}

async function onScreen(page: Page, testId: string): Promise<void> {
  const box = await page.getByTestId(testId).boundingBox();
  const vp = page.viewportSize();
  expect(box, testId).toBeTruthy();
  expect(vp, 'viewport').toBeTruthy();
  if (box === null || vp === null) return;
  expect(box.y).toBeGreaterThanOrEqual(-2);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 2);
}

async function startPlayDuel(page: Page, seed: string): Promise<void> {
  await page.goto(`/3d?seed=${seed}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('play-setup')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('mode-vs-ai').check();
  await page.getByTestId('deck-slot-load-0').click();
  await page.getByTestId('start-vs-ai').click();
  await expect(page.getByTestId('play-duel')).toBeVisible({ timeout: 30_000 });
}

test('/3d portrait and landscape lock the viewport', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/3d?seed=2301', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('play-setup')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('preset-chooser')).toBeVisible();
  await expect(page.getByTestId('deck-slot-0')).toBeVisible();
  expect(await documentScrolls(page)).toBe(false);

  await page.getByTestId('mode-vs-ai').check();
  await page.getByTestId('deck-slot-load-0').click();
  await page.getByTestId('start-vs-ai').click();
  await expect(page.getByTestId('play-duel')).toBeVisible({ timeout: 30_000 });
  expect(await documentScrolls(page)).toBe(false);
  await onScreen(page, 'play-seat-you');
  await onScreen(page, 'play-seat-rival');

  for (let i = 0; i < 8; i += 1) {
    if (
      await page
        .getByTestId('play-battle')
        .isVisible()
        .catch(() => false)
    )
      break;
    const endTurn = page.getByTestId('end-turn');
    if ((await endTurn.isVisible().catch(() => false)) && (await endTurn.isEnabled().catch(() => false))) {
      await endTurn.click();
      continue;
    }
    const battle = page.locator('[data-testid^="node-"][data-battle="1"]').first();
    if ((await battle.count()) > 0) {
      const attacker = page.locator('[data-testid^="node-"][data-movable="1"]').first();
      if ((await attacker.count()) > 0) await attacker.click();
      await battle.click();
      break;
    }
    const deploy = page.locator('[data-testid^="figure-"][data-can="deploy"]:not([disabled])').first();
    if ((await deploy.count()) > 0) {
      await deploy.click();
      const dest = page.locator('[data-testid^="node-"][data-reach="1"]').first();
      if ((await dest.count()) > 0) await dest.click();
      continue;
    }
    const field = page.locator('[data-testid^="node-"][data-movable="1"]').first();
    if ((await field.count()) > 0) {
      await field.click();
      const dest = page.locator('[data-testid^="node-"][data-reach="1"]').first();
      if ((await dest.count()) > 0) await dest.click();
      continue;
    }
    break;
  }

  if (
    await page
      .getByTestId('play-battle')
      .isVisible()
      .catch(() => false)
  ) {
    await expect(page.getByTestId('overlay-spin')).toHaveCount(0);
    await expect(page.getByTestId('play-landed').or(page.getByTestId('battle-outcome'))).toBeVisible({
      timeout: 12_000,
    });
  }

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByTestId('play-duel')).toBeVisible();
  expect(await documentScrolls(page)).toBe(false);
  await onScreen(page, 'play-seat-you');
  await onScreen(page, 'play-seat-rival');
});

test('/3d at 1280x800 does not scroll the document', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await startPlayDuel(page, '2304');
  expect(await documentScrolls(page)).toBe(false);
  await onScreen(page, 'play-seat-you');
  await onScreen(page, 'play-seat-rival');
});

test('/dev at 1280x800 does not scroll the document', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/dev?seed=2302&mode=hotseat', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('dev-banner')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('deck-builder')).toBeVisible();
  expect(await documentScrolls(page)).toBe(false);

  await page.getByTestId('start-duel').click();
  const handoff = page.getByTestId('handover-confirm');
  if (await handoff.isVisible().catch(() => false)) await handoff.click();
  await expect(page.getByTestId('duel')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  expect(await documentScrolls(page)).toBe(false);

  await page.getByTestId('dev-tab-inspector').click();
  await expect(page.getByTestId('inspector')).toBeVisible();
  await page.getByTestId('dev-tab-commands').click();
  await expect(page.getByTestId('legal-moves')).toBeVisible();
  expect(await documentScrolls(page)).toBe(false);
});

test('/dev at 390x844 keeps the document locked and reaches inspector or commands', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dev?seed=2303&mode=hotseat', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('dev-banner')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('deck-builder')).toBeVisible();
  await expect(page.getByTestId('seed-input')).toHaveValue('2303');
  expect(await documentScrolls(page)).toBe(false);

  await page.getByTestId('start-duel').click();
  const handoff = page.getByTestId('handover-confirm');
  if (await handoff.isVisible().catch(() => false)) await handoff.click();
  await expect(page.getByTestId('duel')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('dev-workspace-tabs')).toBeVisible();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  expect(await documentScrolls(page)).toBe(false);

  await page.getByTestId('dev-tab-inspector').click();
  await expect(page.getByTestId('inspector')).toBeVisible();
  expect(await documentScrolls(page)).toBe(false);

  await page.getByTestId('dev-tab-commands').click();
  await expect(page.getByTestId('legal-moves')).toBeVisible();
  expect(await documentScrolls(page)).toBe(false);

  await page.getByTestId('dev-tab-board').click();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  expect(await documentScrolls(page)).toBe(false);

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByTestId('duel')).toBeVisible();
  expect(await documentScrolls(page)).toBe(false);
});
