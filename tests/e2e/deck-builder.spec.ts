import { expect, test } from '@playwright/test';

test('deck builder rejects form-only primaries, over-budget plates, and keeps unimplemented plates disabled', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/dev', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('deck-builder')).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Implemented only').uncheck();
  await page.getByTestId('catalog-tab-figures').click();
  await page.getByTestId('catalog-search').fill('Aegislash');
  const formOnly = page.locator('button.card').filter({ hasText: 'form-only' }).first();
  await expect(formOnly).toBeVisible();
  await formOnly.click();
  await expect(page.locator('.issues li').filter({ hasText: /can only be set as a form/i })).toBeVisible();
  const start = page.getByTestId('start-duel').or(page.getByTestId('start-vs-ai'));
  await expect(start).toBeDisabled();

  await formOnly.click();
  await expect(start).toBeEnabled();

  await page.getByTestId('catalog-tab-plates').click();
  await page.getByLabel('Implemented only').uncheck();
  await page.getByTestId('catalog-search').fill('');
  const unimplemented = page
    .locator('button.card')
    .filter({ has: page.locator('[data-coverage=gap]') })
    .first();
  await expect(unimplemented).toBeDisabled();

  await page.getByLabel('Implemented only').check();
  const cost2 = page.locator('button.card').filter({ hasText: /cost 2/ });
  const count = await cost2.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < Math.min(count, 5); i++) {
    await cost2.nth(i).click();
  }
  const budget = page.locator('.issues li').filter({ hasText: /exceeds the budget|plate cost/i });
  if (!(await budget.isVisible().catch(() => false))) {
    await page.getByLabel('Implemented only').uncheck();
    await page.getByLabel('Debug: allow unimplemented').check();
    const costly = page.locator('button.card').filter({ hasText: /cost 2|cost 3/ });
    const extra = await costly.count();
    for (let i = 0; i < extra && i < 6; i++) {
      await costly.nth(i).click();
    }
  }
  await expect(
    page.locator('.issues li').filter({ hasText: /exceeds the budget|plate cost/i }),
  ).toBeVisible();
  await expect(start).toBeDisabled();
});
