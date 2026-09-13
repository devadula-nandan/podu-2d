/**
 * Manual playtest against `npm run dev` (http://localhost:5173).
 * Drives the real HUD: deck checks, a hotseat game to a result, a vs-AI Easy
 * game to a result, and a watched battle spin when the overlay offers one.
 */
import { chromium } from '@playwright/test';

const BASE = process.env.PLAYTEST_URL ?? 'http://localhost:5173';

async function waitIdle(page) {
  const thinking = page.getByTestId('thinking');
  if (await thinking.isVisible().catch(() => false)) {
    await thinking.waitFor({ state: 'detached', timeout: 60_000 });
  }
}

async function confirmHandover(page) {
  const handoff = page.getByTestId('handover-confirm');
  try {
    await handoff.waitFor({ state: 'visible', timeout: 400 });
    await handoff.click();
    await page.getByTestId('duel').waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    /* no hand-off */
  }
}

async function dismissBattle(page) {
  if (
    await page
      .getByTestId('battle-outcome')
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByRole('button', { name: 'Continue' }).click();
  }
}

async function playOne(page, { vsAi }) {
  if (!vsAi) await confirmHandover(page);
  else await waitIdle(page);
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
      .or(page.getByTestId('handover'))
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
    labels.find((label) => label.startsWith('Battle')) ??
    labels.find((label) => label.startsWith('Deploy')) ??
    labels.find((label) => label.startsWith('Move')) ??
    labels.find((label) => label === 'Spin both wheels') ??
    labels.find((label) => label === 'Decline battle') ??
    labels.find((label) => label === 'Skip plate') ??
    labels[0];
  if (pick === undefined) return null;
  await buttons.filter({ hasText: pick }).first().click();
  return pick;
}

async function playToResult(page, { vsAi, maxSteps, concedeIfNeeded }) {
  const played = [];
  let sawSpin = false;
  for (let i = 0; i < maxSteps; i++) {
    const action = await playOne(page, { vsAi });
    if (action === null) break;
    played.push(action);
    if (action === 'Spin both wheels') sawSpin = true;
    if (action.includes('wins') || action.includes('Draw') || action === 'over') break;
    if (!vsAi) await confirmHandover(page);
    else await waitIdle(page);
    await dismissBattle(page);
  }
  if (
    concedeIfNeeded &&
    !(await page
      .getByTestId('result')
      .isVisible()
      .catch(() => false))
  ) {
    page.once('dialog', (dialog) => {
      void dialog.accept();
    });
    await page.getByRole('button', { name: 'Concede' }).click();
  }
  const result =
    (await page
      .getByTestId('result')
      .textContent()
      .catch(() => null)) ?? 'NO RESULT';
  return { played, sawSpin, result };
}

async function resetToDecks(page) {
  if (
    await page
      .getByRole('button', { name: 'Decks' })
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByRole('button', { name: 'Decks' }).click();
  }
  await page.getByTestId('deck-builder').waitFor({ state: 'visible', timeout: 15_000 });
}

const report = [];
const errors = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => {
  errors.push(`PAGEERROR ${err.message}`);
});
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`CONSOLE ${msg.text()}`);
});

try {
  await page.goto(`${BASE.replace(/\/$/, '')}/dev`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('app-ready').waitFor({ timeout: 60_000 });
  await page.getByTestId('deck-builder').waitFor({ timeout: 60_000 });
  report.push('boot: deck builder visible');

  await page.getByLabel('Implemented only').uncheck();
  await page.getByTestId('catalog-tab-figures').click();
  await page.getByTestId('catalog-search').fill('Aegislash');
  const formOnly = page.locator('button.card').filter({ hasText: 'form-only' }).first();
  await formOnly.waitFor({ state: 'visible', timeout: 10_000 });
  await formOnly.click();
  const formIssue = page.locator('.issues li').filter({ hasText: /can only be set as a form/i });
  await formIssue.waitFor({ state: 'visible', timeout: 5_000 });
  report.push(`deck: form-only rejected → ${await formIssue.textContent()}`);
  const startBtn = page.getByTestId('start-duel').or(page.getByTestId('start-vs-ai'));
  if (!(await startBtn.isDisabled())) {
    throw new Error('Start stayed enabled after form-only add');
  }

  await page.getByTestId('catalog-tab-figures').click();
  await page.getByTestId('catalog-search').fill('Aegislash');
  const formOnlyAgain = page.locator('button.card').filter({ hasText: 'form-only' }).first();
  if (await formOnlyAgain.isVisible().catch(() => false)) await formOnlyAgain.click();
  await page.getByTestId('catalog-tab-plates').click();
  await page.getByLabel('Implemented only').uncheck();
  await page.getByTestId('catalog-search').fill('');
  const unimplemented = page
    .locator('button.card')
    .filter({ hasText: /unimplemented/i })
    .first();
  const unimplDisabled = await unimplemented.isDisabled();
  report.push(`deck: first unimplemented plate disabled=${unimplDisabled}`);
  if (!unimplDisabled) throw new Error('Unimplemented plate was clickable');

  await page.getByLabel('Implemented only').check();
  const cost2 = page.locator('button.card').filter({ hasText: /cost 2/ });
  const cost2Count = await cost2.count();
  for (let i = 0; i < Math.min(cost2Count, 5); i++) await cost2.nth(i).click();
  let budgetVisible = await page
    .locator('.issues li')
    .filter({ hasText: /exceeds the budget|plate cost/i })
    .isVisible()
    .catch(() => false);
  if (!budgetVisible) {
    await page.getByLabel('Implemented only').uncheck();
    await page.getByLabel('Debug: allow unimplemented').check();
    const costly = page.locator('button.card').filter({ hasText: /cost 2|cost 3/ });
    const extra = await costly.count();
    for (let i = 0; i < extra && i < 6; i++) await costly.nth(i).click();
    budgetVisible = await page
      .locator('.issues li')
      .filter({ hasText: /exceeds the budget|plate cost/i })
      .isVisible()
      .catch(() => false);
  }
  report.push(`deck: over-budget rejected=${budgetVisible}`);
  if (!budgetVisible) throw new Error('Plate budget overflow was not rejected');

  await page.getByTestId('decks-open').click();
  await page.getByTestId('use-starters').click();
  await page.getByTestId('decks-close').click();
  await page.getByTestId('seed-input').fill('2');
  await page.getByTestId('mode-hotseat').check();
  await page.getByTestId('start-duel').click();
  await page.getByTestId('duel').or(page.getByTestId('handover')).waitFor({ timeout: 30_000 });
  const hotseat = await playToResult(page, { vsAi: false, maxSteps: 28, concedeIfNeeded: true });
  report.push(`hotseat seed 0x00000002: ${hotseat.result}`);
  report.push(`hotseat actions (${hotseat.played.length}): ${hotseat.played.join(' | ')}`);
  report.push(`hotseat saw spin overlay=${hotseat.sawSpin}`);
  await page.screenshot({ path: 'test-results/play-hotseat.png', fullPage: true });

  await resetToDecks(page);
  await page.getByTestId('decks-open').click();
  await page.getByTestId('use-starters').click();
  await page.getByTestId('decks-close').click();
  await page.getByTestId('seed-input').fill('4');
  await page.getByTestId('mode-vs-ai').check();
  await page.getByTestId('difficulty').selectOption('easy');
  await page.getByTestId('start-vs-ai').click();
  await page.getByTestId('duel').waitFor({ timeout: 30_000 });
  const mode = await page.getByTestId('duel').getAttribute('data-mode');
  if (mode !== 'vsAi') throw new Error(`expected vsAi mode, got ${mode}`);
  const vs = await playToResult(page, { vsAi: true, maxSteps: 30, concedeIfNeeded: true });
  const lastAi = await page
    .getByTestId('ai-last-command')
    .textContent()
    .catch(() => null);
  report.push(`vs-ai Easy seed 0x00000004: ${vs.result}`);
  report.push(`vs-ai actions (${vs.played.length}): ${vs.played.join(' | ')}`);
  report.push(`vs-ai last command: ${lastAi ?? '(none)'}`);
  report.push(`vs-ai saw spin overlay=${vs.sawSpin}`);
  await page.screenshot({ path: 'test-results/play-vs-ai.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('board-canvas').waitFor({ state: 'visible' });
  await page.getByTestId('ai-difficulty').waitFor({ state: 'visible' });
  await page.screenshot({ path: 'test-results/play-vs-ai-390.png', fullPage: true });
  report.push('vs-ai 390px viewport: board + difficulty visible');

  if (!hotseat.sawSpin && !vs.sawSpin) {
    await resetToDecks(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('decks-open').click();
    await page.getByTestId('use-starters').click();
    await page.getByTestId('decks-close').click();
    await page.getByTestId('seed-input').fill('8');
    await page.getByTestId('mode-hotseat').check();
    await page.getByTestId('start-duel').click();
    await page.getByTestId('duel').or(page.getByTestId('handover')).waitFor({ timeout: 30_000 });
    const hunt = await playToResult(page, { vsAi: false, maxSteps: 40, concedeIfNeeded: true });
    report.push(`spin-hunt seed 0x00000008 sawSpin=${hunt.sawSpin} result=${hunt.result}`);
    if (!hunt.sawSpin) report.push('WARN: no battle overlay spin in any game');
  }
} catch (err) {
  errors.push(err instanceof Error ? (err.stack ?? err.message) : String(err));
  await page.screenshot({ path: 'test-results/play-fail.png', fullPage: true }).catch(() => undefined);
} finally {
  await browser.close();
}

console.log('--- PLAYTEST ---');
for (const line of report) console.log(line);
if (errors.length > 0) {
  console.log('--- ERRORS ---');
  for (const line of errors) console.log(line);
  process.exit(1);
}
console.log('--- OK ---');
