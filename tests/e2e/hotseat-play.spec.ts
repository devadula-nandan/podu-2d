import { expect, test, type Page } from '@playwright/test';

async function confirmHandover(page: Page): Promise<void> {
  const handoff = page.getByTestId('handover-confirm');
  try {
    await handoff.waitFor({ state: 'visible', timeout: 400 });
    await handoff.click();
    await page.getByTestId('duel').waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    /* no hand-off this step */
  }
}

async function dismissBattle(page: Page): Promise<void> {
  const outcome = page.getByTestId('battle-outcome');
  if (await outcome.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Continue' }).click();
  }
}

async function playOneAction(page: Page): Promise<string | null> {
  await confirmHandover(page);
  const overlaySpin = page.getByTestId('overlay-spin');
  if (await overlaySpin.isVisible().catch(() => false)) {
    await overlaySpin.click();
    await page
      .getByTestId('battle-outcome')
      .or(page.getByTestId('handover'))
      .or(page.getByTestId('notice'))
      .or(page.getByTestId('handover-battle'))
      .waitFor({ state: 'visible', timeout: 12_000 })
      .catch(() => undefined);
    return 'Spin both wheels';
  }
  await dismissBattle(page);
  if (
    await page
      .getByTestId('result')
      .isVisible()
      .catch(() => false)
  ) {
    return (await page.getByTestId('result').textContent()) ?? 'over';
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
    labels.find(
      (label) => label.startsWith('Deploy') && (label.includes('r4c0') || label.includes('r0c0')),
    ) ??
    labels.find((label) => label.startsWith('Deploy')) ??
    labels.find(
      (label) =>
        label.startsWith('Move') &&
        (label.includes('r3c0') || label.includes('r2c0') || label.includes('r1c0')),
    ) ??
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

test('hotseat starter decks play several turns', async ({ page }) => {
  test.setTimeout(60_000);
  page.on('pageerror', (err) => {
    console.log('PAGEERROR', err.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('CONSOLE', msg.text());
  });
  await page.goto('/dev?mode=hotseat', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('app-ready').or(page.getByText('Content failed to load'))).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('deck-builder')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('catalog-tab-plates').click();
  await page.getByLabel('Implemented only').uncheck();
  await expect(
    page
      .locator('button.card')
      .filter({ has: page.locator('[data-coverage=gap]') })
      .first(),
  ).toBeDisabled();
  await page.getByTestId('catalog-tab-figures').click();
  await page.getByLabel('Implemented only').check();
  await page.getByTestId('seed-input').fill('2202');
  await page.getByTestId('start-duel').click();
  const handoff = page.getByTestId('handover-confirm');
  if (await handoff.isVisible().catch(() => false)) await handoff.click();
  await expect(page.getByTestId('duel')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('phase')).toHaveText(/Move|Plate window|Battle|Spin|Respin/);
  await expect(page.getByTestId('seed')).toContainText('0x0000089a');

  const played: string[] = [];
  for (let i = 0; i < 20; i++) {
    const action = await playOneAction(page);
    if (action === null) break;
    played.push(action);
    if (action === 'over' || action.includes('wins') || action.includes('Draw')) break;
    await confirmHandover(page);
    await dismissBattle(page);
    const turnText = await page
      .getByTestId('turn')
      .textContent()
      .catch(() => null);
    const spun = played.includes('Spin both wheels');
    if (
      turnText !== null &&
      Number(turnText) > 8 &&
      spun &&
      played.some((row) => row.startsWith('Battle') || row === 'Decline battle')
    ) {
      break;
    }
  }

  console.log('hotseat actions', played);
  expect(played.length).toBeGreaterThan(6);
  await page.screenshot({ path: 'test-results/hotseat-board.png', fullPage: true });
  await expect(page.getByTestId('opponent-plates').or(page.getByText('Opponent plates:'))).toBeVisible();
  await expect(page.getByText(/hidden unused/)).toBeVisible();

  await confirmHandover(page);
  await dismissBattle(page);
  await page.keyboard.press('Escape');
  const canvas = page.getByTestId('board-canvas');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('board canvas has no box');
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.getByTestId('notice')).toBeVisible();
  await expect(page.getByTestId('notice')).toContainText('missed the graph');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

test('hotseat starter decks can be played to a concession result', async ({ page }) => {
  test.setTimeout(90_000);
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.goto('/dev?mode=hotseat', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('deck-builder')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('seed-input').fill('2204');
  await page.getByTestId('start-duel').click();
  const handoff = page.getByTestId('handover-confirm');
  if (await handoff.isVisible().catch(() => false)) await handoff.click();
  await expect(page.getByTestId('duel')).toBeVisible({ timeout: 30_000 });

  for (let i = 0; i < 16; i++) {
    const action = await playOneAction(page);
    if (action === null) break;
    if (action === 'over' || action.includes('wins') || action.includes('Draw')) break;
    await confirmHandover(page);
    await dismissBattle(page);
  }

  await confirmHandover(page);
  await dismissBattle(page);
  if (
    !(await page
      .getByTestId('result')
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByRole('button', { name: 'Concede' }).click();
  }
  await expect(page.getByTestId('result')).toBeVisible();
  await expect(page.getByTestId('result')).toHaveText(/wins|Draw/);
});
