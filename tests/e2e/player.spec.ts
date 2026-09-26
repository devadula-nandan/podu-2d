import { expect, test, type Page } from '@playwright/test';

async function confirmHandover(page: Page): Promise<void> {
  const handoff = page.getByTestId('handover-confirm');
  try {
    await handoff.waitFor({ state: 'visible', timeout: 400 });
    await handoff.click();
    await page.getByTestId('play-duel').waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    /* no hand-off this step */
  }
}

async function playOneAction(page: Page): Promise<string | null> {
  await confirmHandover(page);
  await expect(page.getByTestId('play-to-move')).toContainText('Your turn', { timeout: 30_000 });
  if (await page.getByTestId('result').isVisible().catch(() => false)) {
    return (await page.getByTestId('result').textContent()) ?? 'over';
  }
  const overlay = page.getByTestId('play-battle');
  if (await overlay.isVisible().catch(() => false)) {
    await page
      .getByTestId('battle-outcome')
      .or(page.getByTestId('play-landed'))
      .or(page.getByTestId('handover'))
      .waitFor({ state: 'visible', timeout: 12_000 })
      .catch(() => undefined);
    return 'spin';
  }
  const battleNode = page.locator('[data-testid^="node-"][data-battle="1"]').first();
  if ((await battleNode.count()) > 0) {
    const attacker = page.locator('[data-testid^="node-"][data-movable="1"]').first();
    if ((await attacker.count()) > 0) await attacker.click();
    await battleNode.click();
    return 'battle';
  }
  const endTurn = page.getByTestId('end-turn');
  if ((await endTurn.isVisible().catch(() => false)) && (await endTurn.isEnabled().catch(() => false))) {
    await endTurn.click();
    return 'end-turn';
  }
  const deploy = page
    .locator('[data-testid="play-seat-you"] [data-testid^="figure-"][data-can="deploy"]:not([disabled])')
    .first();
  if ((await deploy.count()) > 0) {
    await deploy.click();
    const dest = page.locator('[data-testid^="node-"][data-reach="1"]').first();
    await expect(dest).toBeVisible({ timeout: 4_000 });
    await dest.click();
    return 'deploy';
  }
  const field = page.locator('[data-testid^="node-"][data-movable="1"]').first();
  if ((await field.count()) > 0) {
    await field.click();
    const dest = page.locator('[data-testid^="node-"][data-reach="1"]').first();
    if ((await dest.count()) > 0) {
      await dest.click();
      return 'move';
    }
  }
  return null;
}

test('/3d is the player table', async ({ page }) => {
  await page.goto('/3d');
  await expect(page.getByTestId('play-ready')).toBeVisible();
  await expect(page.getByTestId('play-setup').or(page.getByTestId('play-duel'))).toBeVisible();
  await expect(page.getByRole('link', { name: 'Dev' })).toBeVisible();
});

test('/3d?seed=2 starts without a seat picker and deploys near the bottom', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/3d?seed=2111', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('play-ready')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('play-setup')).toBeVisible();
  await expect(page.getByTestId('seed-input')).toHaveValue('2111');
  await expect(page.getByTestId('human-seat')).toHaveCount(0);
  await page.getByTestId('mode-vs-ai').check();
  await page.getByTestId('deck-slot-load-0').click();
  await page.getByTestId('start-vs-ai').click();
  await expect(page.getByTestId('play-duel')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('handover')).toHaveCount(0);
  await expect(page.getByTestId('play-strip')).toBeVisible();
  await expect(page.getByTestId('board-canvas')).toBeVisible();

  const action = await playOneAction(page);
  expect(action === 'deploy' || action === 'end-turn' || action === 'move').toBe(true);
  if (action === 'end-turn') {
    const again = await playOneAction(page);
    expect(again).toBe('deploy');
  }
  const occupied = page.getByTestId('field-occupancy').locator('li').first();
  await expect(occupied).toHaveCount(1, { timeout: 8_000 });
  const node = await occupied.getAttribute('data-node');
  expect(node).toBeTruthy();
  if (node !== null) {
    const y = Number(await page.getByTestId(`node-${node}`).getAttribute('data-y'));
    expect(y).toBeGreaterThan(55);
  }
  await expect(page.getByTestId('play-duel')).toBeVisible();
  await page.screenshot({ path: 'test-results/player-2d-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('play-duel')).toBeVisible();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  await expect(page.getByTestId('play-seat-you')).toBeVisible();
  await page.screenshot({ path: 'test-results/player-2d-390.png', fullPage: true });
});

test('/3d vs AI Easy starts without debug chrome', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/3d?seed=2112', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('play-setup')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('mode-vs-ai').check();
  await expect(page.getByTestId('human-seat')).toHaveCount(0);
  await page.getByTestId('difficulty').selectOption('easy');
  await page.getByTestId('deck-slot-load-0').click();
  await page.getByTestId('start-vs-ai').click();
  await expect(page.getByTestId('play-duel')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('play-duel')).toHaveAttribute('data-mode', 'vsAi');
  await expect(page.getByTestId('legal-moves')).toHaveCount(0);
  await expect(page.getByTestId('inspector')).toHaveCount(0);
  await expect(page.getByTestId('replay-scrubber')).toHaveCount(0);
});

test('/3d plates and figures are both live; End turn is hidden until an optional battle', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/3d?seed=2110', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('play-setup')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('mode-vs-ai').check();
  await page.getByTestId('deck-slot-load-0').click();
  await page.getByTestId('start-vs-ai').click();
  await expect(page.getByTestId('play-duel')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('skip-plate')).toHaveCount(0);
  await expect(page.getByTestId('decline-battle')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Skip plate' })).toHaveCount(0);
  await expect(page.getByTestId('play-strip')).toBeVisible();
  await expect(page.getByTestId('end-turn')).toHaveCount(0);
  await expect(page.locator('[data-testid^="play-plate-"]:not([disabled])').first()).toBeVisible({
    timeout: 8_000,
  });
  await expect(page.locator('[data-testid^="figure-"][data-can="deploy"]').first()).toBeVisible({
    timeout: 8_000,
  });

  const plate = page.locator('[data-testid^="play-plate-"]:not([disabled])').first();
  await plate.click();
  const prompt = ((await page.getByTestId('play-prompt').textContent()) ?? '').trim();
  if (/choose/i.test(prompt)) {
    await page.locator('[data-testid="play-seat-you"] [data-testid^="figure-"]:not([disabled])').first().click();
  }
  await expect(page.locator('[data-testid^="play-plate-"][data-used="1"]').first()).toBeVisible({
    timeout: 8_000,
  });
  await expect(page.getByTestId('play-strip')).toContainText(/Played|turn/i);
  await expect(page.getByTestId('end-turn')).toHaveCount(0);
});
