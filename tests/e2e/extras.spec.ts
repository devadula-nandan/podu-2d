import { expect, test } from '@playwright/test';

test('shareable ?seed= loads, undo walks back a deploy, odds sum to 100%, coverage badges show gaps', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/dev?seed=42&mode=hotseat', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('deck-builder')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('seed-input')).toHaveValue('42');
  await expect(page).toHaveURL(/[?&]seed=42/);

  await page.getByLabel('Implemented only').uncheck();
  await page.getByTestId('catalog-tab-plates').click();
  const plateGap = page
    .locator('[data-testid="coverage-badge"][data-coverage="gap"][data-kind="plate"]')
    .first();
  await expect(plateGap).toBeVisible();
  await expect(plateGap).toHaveText('gap');

  await page.getByTestId('catalog-tab-figures').click();
  const figureGap = page
    .locator('[data-testid="coverage-badge"][data-coverage="gap"][data-kind="figure"]')
    .first();
  await expect(figureGap).toBeVisible();

  await page.getByLabel('Implemented only').check();
  await page.getByTestId('copy-seed').click();
  await expect(page.getByTestId('copied-seed')).toContainText('seed=42');

  await page.getByTestId('start-duel').click();
  const handoff = page.getByTestId('handover-confirm');
  if (await handoff.isVisible().catch(() => false)) await handoff.click();
  await expect(page.getByTestId('duel')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('seed')).toContainText('0x0000002a');

  await page.getByTestId('dev-tab-inspector').click();
  await expect(page.getByTestId('inspector').getByTestId('odds-sum')).toHaveText(/96\/96 = 100%/);

  await page.getByTestId('dev-tab-commands').click();
  const deploy = page
    .locator('[data-testid="legal-moves"] button')
    .filter({ hasText: /^Deploy / })
    .first();
  await expect(deploy).toBeVisible();
  const label = (await deploy.textContent()) ?? '';
  await deploy.click();
  await expect(page.getByTestId('undo')).toBeEnabled();
  await page.getByTestId('undo').click();
  await expect(page.locator('[data-testid="legal-moves"] button').filter({ hasText: label })).toBeVisible();

  await page.getByTestId('dev-tab-scrub').click();
  await expect(page.getByTestId('replay-scrubber')).toBeVisible();

  await page.getByTestId('dev-tab-machine').click();
  await expect(page.getByTestId('phase-machine')).toBeVisible();
  await expect(page.getByTestId('phase-machine')).toHaveAttribute('data-phase', /.+/);
});
