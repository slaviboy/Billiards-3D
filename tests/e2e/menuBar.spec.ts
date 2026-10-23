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

// The menu bar: a computer has it in place of the menu button, in a top bar no wider than what it
// holds, over the cards; its menus change the view and the settings, open the dialogs and concede
// a rack; the keys work them without moving the camera, and Escape still opens the pause menu.
// With the controls on the left the bar keeps to the right, and its menus on the screen. A phone
// has the menu button until the bar is chosen, and the bar then fits the screen and leaves the
// table in sight.

import { expect, test, type Page } from '@playwright/test';
import { covered, settle } from '../support/screen.ts';

async function startMatch(page: Page) {
  await page.goto('./');
  await expect(page.locator('#app[data-ready="true"]')).toBeAttached();
  await page.locator('.mode-card[data-mode="local"]').click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.dialog')).toHaveCount(0);
}

/** An entry of the menu open now (the submenu's, if one is open), by the start of its name. */
function entry(page: Page, name: string) {
  return page
    .locator('.menu')
    .last()
    .locator('.menu-entry')
    .filter({ has: page.locator('.menu-label', { hasText: name }) });
}

const stored = (page: Page) => page.evaluate(() => localStorage.getItem('pool.settings.v2') ?? '');

test('a computer has the menu bar, and its menus do what the menu did', async ({ page }) => {
  await startMatch(page);
  const bar = page.getByRole('menubar', { name: 'Main menu' });
  await expect(bar).toBeVisible();
  await expect(page.getByRole('button', { name: 'Menu (Esc)' })).toBeHidden();
  // The top bar is as wide as what it holds, in the corner over the cards.
  const top = (await page.locator('.hud-top').boundingBox())!;
  const buttons = (await page.locator('.hud-buttons').boundingBox())!;
  const cards = (await page.locator('.hud-players').boundingBox())!;
  expect(top.x + top.width - (buttons.x + buttons.width)).toBeLessThan(16);
  expect(top.width).toBeLessThan(1174 * 0.7);
  expect(Math.abs(top.x - cards.x)).toBeLessThan(1);
  expect(cards.y).toBeGreaterThan(top.y + top.height);
  const open = (menu: string) => bar.getByRole('menuitem', { name: menu, exact: true }).click();

  await open('View');
  await entry(page, 'Top view').click();
  await expect.poll(() => page.evaluate(() => window.__poolDebug!.view())).toBe('top');
  await expect(page.locator('.menu')).toHaveCount(0);

  await open('Options');
  await entry(page, 'Cloth').click();
  await entry(page, 'Green').click();
  await expect.poll(() => stored(page)).toContain('"cloth":"yellowGreen"');
  await expect(page.locator('.menu')).toHaveCount(0);

  await open('Options');
  await entry(page, 'All settings').click();
  await expect(page.locator('.dialog .title')).toHaveText('Settings');
  await page.keyboard.press('Escape');
  await expect(page.locator('.dialog')).toHaveCount(0);

  // The keys: Alt+V opens the View menu, the arrows move in it and Escape shuts it, and none of
  // them turns the camera; Escape with no menu open is still the pause menu.
  await settle(page);
  const camera = await page.evaluate(() => window.__poolDebug!.camera());
  await page.keyboard.press('Alt+V');
  await expect(page.locator('.menu')).toBeVisible();
  await expect(entry(page, 'Top view')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(entry(page, 'Reset the view')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu')).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.pause-menu')).toHaveCount(0);
  expect(await page.evaluate(() => window.__poolDebug!.camera())).toEqual(camera);
  // Escape closed the menu onto its name in the bar; back at the table, Escape is the pause menu.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.dialog')).toHaveCount(0);

  await open('Game');
  await entry(page, 'Concede the rack').click();
  await expect(page.locator('.result-dialog')).toBeVisible();
  await expect(page.locator('.result-dialog')).toContainText('conceded the rack');
});

test('with the controls on the left, the bar keeps right and its menus on the screen', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('pool.settings.v2', JSON.stringify({ leftHanded: true })),
  );
  await startMatch(page);
  const width = page.viewportSize()!.width;
  const top = (await page.locator('.hud-top').boundingBox())!;
  expect(width - (top.x + top.width)).toBeLessThan(16);
  const bar = page.getByRole('menubar', { name: 'Main menu' });
  for (const [menu, sub] of [
    ['View', 'Aiming guide'],
    ['Options', 'Cloth'],
    ['Help', null],
  ] as const) {
    await bar.getByRole('menuitem', { name: menu, exact: true }).click();
    if (sub) await entry(page, sub).click();
    await expect(page.locator('.menu')).toHaveCount(sub ? 2 : 1);
    for (const box of await page
      .locator('.menu')
      .evaluateAll((menus) => menus.map((m) => m.getBoundingClientRect().toJSON() as DOMRect))) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('.menu')).toHaveCount(0);
  }
});

test.describe('a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('has the menu button, and the menu bar when chosen', async ({ page }) => {
    await startMatch(page);
    const bar = page.getByRole('menubar', { name: 'Main menu' });
    const button = page.getByRole('button', { name: 'Menu (Esc)' });
    await expect(bar).toBeHidden();
    await button.tap();
    await page.locator('.pause-item[data-choice="settings"]').tap();
    await page.getByRole('switch', { name: 'Menu bar, instead of the menu button' }).tap();
    await page.keyboard.press('Escape');
    await expect(page.locator('.dialog')).toHaveCount(0);
    await expect(bar).toBeVisible();
    await expect(button).toBeHidden();
    expect(await stored(page)).toContain('"menuBar":true');

    await settle(page);
    const top = (await page.locator('.hud-top').boundingBox())!;
    expect(top.x).toBeGreaterThanOrEqual(0);
    expect(top.x + top.width).toBeLessThanOrEqual(390);
    expect(await covered(page)).toEqual([]);

    await bar.getByRole('menuitem', { name: 'Game', exact: true }).tap();
    const menu = (await page.locator('.menu').boundingBox())!;
    expect(menu.x + menu.width).toBeLessThanOrEqual(390);
  });
});
