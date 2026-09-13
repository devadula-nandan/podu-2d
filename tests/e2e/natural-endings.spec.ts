import { expect, test, type Page } from '@playwright/test';

async function confirmHandover(page: Page): Promise<void> {
  const handoff = page.getByTestId('handover-confirm');
  if (await handoff.isVisible().catch(() => false)) {
    await handoff.click();
    await page.getByTestId('duel').waitFor({ state: 'visible', timeout: 5_000 });
  }
}

async function dismissBattle(page: Page): Promise<void> {
  const outcome = page.getByTestId('battle-outcome');
  if (await outcome.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Continue' }).click();
  }
}

async function startHotseat(page: Page, seed: string): Promise<void> {
  await page.goto('/dev', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('deck-builder')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('mode-hotseat').check();
  await page.getByTestId('seed-input').fill(seed);
  await page.getByTestId('start-duel').click();
  const handoff = page.getByTestId('handover-confirm');
  try {
    await handoff.waitFor({ state: 'visible', timeout: 2_000 });
    await handoff.click();
  } catch {
    /* seat A already to-move */
  }
  await expect(page.getByTestId('duel')).toBeVisible({ timeout: 30_000 });
}

async function clickLegal(page: Page, label: string): Promise<void> {
  await confirmHandover(page);
  await dismissBattle(page);
  if (
    !(await page
      .getByTestId('legal-moves')
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByTestId('dev-tab-commands').click();
  }
  const button = page.locator('[data-testid="legal-moves"] button', { hasText: label }).first();
  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.click();
}

test.describe('natural endings in the HUD', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90_000);

  test('hotseat seed 2: Seat B goal win is visible', async ({ page }) => {
    await startHotseat(page, '2');
    await expect(page.getByTestId('seed')).toContainText('0x00000002');

    await clickLegal(page, 'Deploy Charmander → i2c0');
    await clickLegal(page, 'Deploy Murkrow → i1c0');
    await clickLegal(page, 'Decline battle');
    await clickLegal(page, 'Move Charmander → i1c2');
    await clickLegal(page, 'Move Murkrow → r4c2');
    await clickLegal(page, 'Move Charmander → r0c4');
    await clickLegal(page, 'Move Murkrow → r4c3');

    await expect(page.getByTestId('result')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('result')).toContainText(/Seat B wins/);
    await expect(page.getByTestId('result')).toContainText(/goal/);
    await page.screenshot({ path: 'test-results/hud-goal-win.png', fullPage: true });
  });

  test('hotseat seed 2: Murkrow surround KO is visible in P.C.', async ({ page }) => {
    await startHotseat(page, '2');

    await clickLegal(page, 'Deploy Charmander → i2c0');
    await clickLegal(page, 'Deploy Murkrow → r0c1');
    await clickLegal(page, 'Deploy Ekans → i1c2');
    await clickLegal(page, 'Move Murkrow → i1c0');
    await clickLegal(page, 'Decline battle');
    await clickLegal(page, 'Move Ekans → i0c0');

    await expect(page.getByTestId('result')).toHaveCount(0);
    await expect(page.getByTestId('surround-notice')).toContainText(
      /Murkrow was surrounded and sent to the P\.C\./,
    );
    await expect(page.getByTestId('handover-surround')).toContainText(/Murkrow was surrounded/);
    await expect(page.getByTestId('pc-1')).toContainText('P.C. 1/2');
    await expect(page.getByTestId('pc-card-6')).toContainText('Murkrow');
    await expect(page.getByTestId('command-log')).toContainText(/surrounded/);
    await page.screenshot({ path: 'test-results/hud-surround-ko.png', fullPage: true });
  });

  test('hotseat clocks tick from real elapsed time', async ({ page }) => {
    await startHotseat(page, '2212');
    const before = (await page.getByTestId('clocks').textContent()) ?? '';
    expect(before).toMatch(/^[45]:\d{2} \/ 5:00$/);
    await page.waitForTimeout(2500);
    const after = (await page.getByTestId('clocks').textContent()) ?? '';
    expect(after).toMatch(/4:\d{2} \/ 5:00/);
    expect(after).not.toBe(before);
    await page.screenshot({ path: 'test-results/hud-clock-tick.png', fullPage: true });
  });

  test('vs AI Easy: clocks still tick while the AI is thinking', async ({ page }) => {
    await page.goto('/dev', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('deck-builder')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('mode-vs-ai').check();
    await page.getByTestId('difficulty').selectOption('easy');
    await page.getByTestId('seed-input').fill('2214');
    await page.getByTestId('start-vs-ai').click();
    await expect(page.getByTestId('duel')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2500);
    const after = (await page.getByTestId('clocks').textContent()) ?? '';
    expect(after).not.toBe('5:00 / 5:00');
    await page.screenshot({ path: 'test-results/hud-clock-vs-ai.png', fullPage: true });
  });
});
