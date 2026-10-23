/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * This file is part of Pool.
 *
 * Pool is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version. See the LICENSE file for the full terms.
 */

// Two players on one device, through the interface: the menu starts a match, the keyboard breaks,
// the rules' choices and notes appear, the pause menu concedes a rack, the result offers the next
// one and the break passes to the other player.

import { expect, test, type Page } from '@playwright/test';

const match = (page: Page) => page.evaluate(() => window.__poolDebug!.match());

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#app[data-ready="true"]')).toBeAttached();
});

test('a match on this device, from the menu to the second rack', async ({ page }) => {
  await page.locator('.mode-card[data-mode="local"]').click();
  await page.getByLabel('First player', { exact: true }).fill('Ada');
  await page.getByLabel('Second player', { exact: true }).fill('Bo');
  await page.getByRole('radio', { name: 'First player' }).click();
  await page.getByRole('button', { name: 'Start' }).click();

  await expect(page.getByTestId('status')).toContainText('Ada to break');
  await expect(page.getByTestId('player-0')).toHaveClass(/active/);
  await expect(page.getByTestId('player-1')).toContainText('Bo');
  await expect(page.locator('.race')).toHaveText('Race to 3');

  // Full power with the keyboard, then Space: the break.
  await page.evaluate(() => window.__poolDebug!.setPlaybackSpeed(8));
  for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowUp');
  await expect(page.getByTestId('power')).toContainText('100%');
  await page.keyboard.press('Space');
  await expect.poll(async () => (await match(page)).shot, { timeout: 20000 }).toBe(1);

  // Whatever the break left: a choice to make, or play on.
  const after = await match(page);
  if (after.phase === 'decision') {
    const choice = page.locator('.choice-list .btn').first();
    await expect(choice).toBeVisible();
    await choice.click();
  }
  await expect.poll(async () => (await match(page)).phase).toMatch(/play|break/);

  // The pause menu: the player at the table concedes the rack.
  const shooter = (await match(page)).turn;
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-menu')).toBeVisible();
  await page.locator('.pause-item[data-choice="concede"]').click();
  const result = page.locator('.result-dialog');
  await expect(result).toBeVisible();
  await expect(result).toContainText('wins the rack');
  await expect(result).toContainText('conceded');
  await result.getByRole('button', { name: 'Next rack' }).click();

  const second = await match(page);
  expect(second.rackNumber).toBe(2);
  expect(second.phase).toBe('break');
  expect(second.score[shooter === 0 ? 1 : 0]).toBe(1);
  // Breaks alternate: Ada broke the first rack, Bo breaks the second.
  expect(second.turn).toBe(1);
  await expect(page.getByTestId('status')).toContainText('Bo to break');
});

test('the 8 waits for a called pocket, and a marker over each pocket calls it', async ({
  page,
}) => {
  await page.locator('.mode-card[data-mode="local"]').click();
  await page.getByRole('button', { name: 'Start' }).click();
  // Solids cleared for the first player: only the 8 and two stripes are left.
  await page.evaluate(() =>
    window.__poolDebug!.arrange({ groups: [1, 2], turn: 0, onTable: [8, 9, 10] }),
  );
  const status = page.getByTestId('status');
  await expect(status).toContainText('call a pocket for the 8');
  const marks = page.locator('.pocket-mark');
  await expect(marks).toHaveCount(6);
  await expect(marks.first()).toBeVisible();
  // The card rings the 8, at the end of the cleared group, as the ball to shoot.
  await expect(page.getByTestId('player-0').locator('.ball-glyph.target[title="8"]')).toHaveCount(
    1,
  );
  await expect(page.getByTestId('player-0').locator('.ball-glyph.potted')).toHaveCount(7);

  // No shot without a call.
  await page.keyboard.press('Space');
  await expect(page.locator('.toast', { hasText: 'Call a pocket for the 8 first' })).toBeVisible();
  expect((await page.evaluate(() => window.__poolDebug!.match())).shot).toBe(0);

  await marks.nth(3).click();
  await expect(marks.nth(3)).toHaveAttribute('aria-pressed', 'true');
  await expect(status).toContainText('pocket called');
  await page.evaluate(() => window.__poolDebug!.setPlaybackSpeed(8));
  // Each shot starts from no power: set some, then Space.
  for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Space');
  await expect
    .poll(async () => (await page.evaluate(() => window.__poolDebug!.match())).shot, {
      timeout: 20000,
    })
    .toBe(1);
  await expect(marks.first()).toBeHidden();
});

test('practice has one player, no turns and no pocket calls', async ({ page }) => {
  await page.locator('.mode-card[data-mode="practice"]').click();
  await expect(page.getByTestId('status')).toContainText('Ball in hand');
  await expect(page.locator('.pocket-picker')).toBeHidden();
  await expect(page.getByTestId('player-1')).toBeHidden();
  await expect(page.locator('.race')).toHaveText('Practice');
});
