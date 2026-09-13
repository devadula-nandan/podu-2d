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

test('/2d?seed=2 starter decks show species sprites after deploy', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/2d?seed=2114', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('play-setup')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('sprite-attribution')).toContainText('not open-source');
  await page.getByTestId('mode-vs-ai').check();
  await page.getByTestId('use-starters').click();
  await page.getByTestId('start-vs-ai').click();
  await expect(page.getByTestId('play-duel').or(page.getByTestId('handover'))).toBeVisible({
    timeout: 30_000,
  });
  await confirmHandover(page);
  await expect(page.getByTestId('play-duel')).toBeVisible();

  const benchSprite = page.getByTestId('figure-sprite').first();
  await expect(benchSprite).toBeVisible({ timeout: 10_000 });
  await expect(benchSprite).toHaveAttribute('src', /raw\.githubusercontent\.com\/PokeAPI\/sprites\/.*\/\d+\.png/);

  const deploy = page.locator('[data-testid^="figure-"][data-can="deploy"]').first();
  await expect(deploy).toBeVisible({ timeout: 8_000 });
  await deploy.click();
  const dest = page.locator('[data-testid^="node-"][data-reach="1"]').first();
  await expect(dest).toBeVisible({ timeout: 4_000 });
  await dest.click();

  const field = page.locator('[data-testid^="node-"][data-sprite]');
  await expect(field.first()).toBeVisible({ timeout: 8_000 });
  const url = await field.first().getAttribute('data-sprite');
  const name = await field.first().getAttribute('data-sprite-name');
  expect(url).toMatch(
    /raw\.githubusercontent\.com\/PokeAPI\/sprites\/master\/sprites\/pokemon\/other\/official-artwork\/\d+\.png/,
  );
  expect(name === null || name.length <= 2).toBe(false);
  expect(name).toMatch(/^[A-Za-z][A-Za-z .'-]+$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('play-duel')).toBeVisible();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  await expect(page.getByTestId('play-seat-you')).toBeVisible();
  await expect(page.locator('[data-testid^="node-"][data-sprite]').first()).toBeVisible();
});
