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

// On a phone, upright and on its side: the interface leaves every pocket and the cue ball in
// sight in both views, nothing spills off the screen, the dock is no taller than its controls and
// they are a finger's size, and a finger can work them without leaving their tips standing.

import { expect, test, type Page } from '@playwright/test';
import { covered, settle } from '../support/screen.ts';

/** Parts of the interface reaching past the screen's edges. */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '.hud-top, .status-pill, .hud-dock, .power, .status, .fine-aim, .spin, .player-card, .hud-buttons',
      ),
    ]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight;
      })
      .map((e) => e.className),
  );
}

for (const [name, width, height] of [
  ['upright', 390, 844],
  ['on its side', 844, 390],
] as const) {
  test.describe(`a phone ${name}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: true });

    test('keeps the pockets and the cue ball in sight in both views', async ({ page }) => {
      await page.goto('./');
      await expect(page.locator('#app[data-ready="true"]')).toBeAttached();
      await page.locator('.mode-card[data-mode="local"]').tap();
      await page.getByRole('button', { name: 'Start' }).tap();
      await settle(page);
      expect(await overflowing(page)).toEqual([]);
      expect(await covered(page)).toEqual([]);
      await page.evaluate(() => window.__poolDebug!.setView('top'));
      await settle(page);
      expect(await covered(page)).toEqual([]);
    });

    test('keeps the dock low, and its controls a finger high', async ({ page }) => {
      await page.goto('./');
      await expect(page.locator('#app[data-ready="true"]')).toBeAttached();
      await page.locator('.mode-card[data-mode="local"]').tap();
      await page.getByRole('button', { name: 'Start' }).tap();
      // Past the break, so that the call of a safety shows.
      await page.evaluate(() =>
        window.__poolDebug!.arrange({ groups: [1, 2], turn: 0, onTable: [0, 1, 8, 9] }),
      );
      const height = async (selector: string) =>
        (await page.locator(selector).first().boundingBox())!.height;
      expect(await height('.hud-dock')).toBeLessThanOrEqual(64);
      for (const control of ['.spin-ball', '.step-btn', '.fine-aim', '.safety']) {
        expect(await height(control)).toBeGreaterThanOrEqual(36);
      }
    });

    test('a finger works the spin and the power, and leaves no tip standing', async ({ page }) => {
      await page.goto('./?menu=0');
      await expect(page.locator('#app[data-ready="true"]')).toBeAttached();
      await settle(page);
      // A touch screen keeps the last element touched hovered: its tip must not show for that.
      const tip = (selector: string) =>
        page.evaluate(
          (s) => getComputedStyle(document.querySelector(s)!, '::after').content,
          selector,
        );
      // A tap high on the cue ball's face: top spin.
      const ball = page.locator('.spin-ball');
      const box = (await ball.boundingBox())!;
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.3);
      const aim = await page.evaluate(() => window.__poolDebug!.aim());
      expect(aim.b).toBeGreaterThan(0.2);
      expect(Math.abs(aim.a)).toBeLessThan(0.05);
      expect(await tip('.spin-ball')).toBe('none');
      // A tap high on the cue elevation's groove raises the cue.
      const groove = (await page.locator('.elevation-track').boundingBox())!;
      await page.touchscreen.tap(groove.x + groove.width / 2, groove.y + groove.height * 0.2);
      expect((await page.evaluate(() => window.__poolDebug!.aim())).elevation).toBeGreaterThan(20);
      expect(await tip('.spin-elevation')).toBe('none');
      // A tap on the power bar is a press and a release: it shoots.
      const track = (await page.locator('.power-track').boundingBox())!;
      await page.evaluate(() => window.__poolDebug!.setPlaybackSpeed(8));
      await page.touchscreen.tap(track.x + track.width / 2, track.y + track.height * 0.5);
      await expect
        .poll(async () => (await page.evaluate(() => window.__poolDebug!.match())).shot, {
          timeout: 20000,
        })
        .toBe(1);
      expect(await tip('.power')).toBe('none');
    });
  });
}
