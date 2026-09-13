import { expect, test, type Page } from '@playwright/test';

async function waitIdle(page: Page): Promise<void> {
  const thinking = page.getByTestId('thinking');
  if (await thinking.isVisible().catch(() => false)) {
    await thinking.waitFor({ state: 'detached', timeout: 60_000 });
  }
}

async function dismissBattle(page: Page): Promise<void> {
  const outcome = page.getByTestId('battle-outcome');
  if (await outcome.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Continue' }).click();
  }
}

async function playOneHumanAction(page: Page): Promise<string | null> {
  await waitIdle(page);
  await dismissBattle(page);
  if (
    await page
      .getByTestId('result')
      .isVisible()
      .catch(() => false)
  ) {
    return (await page.getByTestId('result').textContent()) ?? 'over';
  }
  const overlaySpin = page.getByTestId('overlay-spin');
  if (await overlaySpin.isVisible().catch(() => false)) {
    await overlaySpin.click();
    await page
      .getByTestId('battle-outcome')
      .or(page.getByTestId('thinking'))
      .or(page.getByTestId('result'))
      .waitFor({ state: 'visible', timeout: 8_000 })
      .catch(() => undefined);
    return 'Spin both wheels';
  }
  if (
    !(await page
      .getByTestId('legal-moves')
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByTestId('dev-tab-commands').click();
  }
  const buttons = page.locator('[data-testid="legal-moves"] button');
  const count = await buttons.count();
  if (count === 0) return null;
  const labels = await buttons.allTextContents();
  const pick =
    labels.find((label) => label.startsWith('Deploy')) ??
    labels.find((label) => label.startsWith('Move')) ??
    labels.find((label) => label.startsWith('Battle')) ??
    labels.find((label) => label === 'Spin both wheels') ??
    labels.find((label) => label === 'Decline battle') ??
    labels.find((label) => label === 'Skip plate') ??
    labels[0];
  if (pick === undefined) return null;
  await buttons.filter({ hasText: pick }).first().click();
  return pick;
}

test('vs AI Easy starts, thinks off the main thread, and can finish by concession', async ({ page }) => {
  test.setTimeout(120_000);
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.goto('/dev', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('deck-builder')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('mode-vs-ai').check();
  await page.getByTestId('difficulty').selectOption('easy');
  await page.getByTestId('seed-input').fill('2210');
  await page.getByTestId('start-vs-ai').click();
  await expect(page.getByTestId('duel')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('duel')).toHaveAttribute('data-mode', 'vsAi');
  await expect(page.getByTestId('seed')).toContainText('0x000008a2');
  await expect(page.getByTestId('ai-difficulty')).toBeVisible();

  const played: string[] = [];
  for (let i = 0; i < 24; i++) {
    const action = await playOneHumanAction(page);
    if (action === null) break;
    played.push(action);
    if (action === 'over' || action.includes('wins') || action.includes('Draw')) break;
    await waitIdle(page);
    await dismissBattle(page);
  }

  await waitIdle(page);
  if (
    !(await page
      .getByTestId('result')
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByRole('button', { name: 'Concede' }).click();
  }
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('command-log')).toBeVisible();
  expect(played.length).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/vs-ai-easy.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('duel')).toBeVisible();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  await expect(page.getByTestId('ai-difficulty')).toBeVisible();
  await page.screenshot({ path: 'test-results/vs-ai-easy-390.png', fullPage: true });
});
