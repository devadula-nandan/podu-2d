import { expect, test } from '@playwright/test';

/**
 * Boots the real shell. Players land on /2d. The debug client lives at /dev.
 */
test('the root redirects to the player table', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/2d/);
  await expect(page.getByTestId('play-ready')).toBeVisible();
});

test('developer client still starts a hotseat duel', async ({ page }) => {
  await page.goto('/dev?mode=hotseat');
  await expect(page.getByTestId('dev-banner')).toBeVisible();
  await expect(page.getByTestId('app-ready')).toBeVisible();
  await expect(page.getByTestId('deck-builder')).toBeVisible();
  await page.getByTestId('start-duel').click();
  const handoff = page.getByTestId('handover-confirm');
  if (await handoff.isVisible().catch(() => false)) await handoff.click();
  await expect(page.getByTestId('duel')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pokémon Duel');
});
