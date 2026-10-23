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
// sight in both views, nothing spills off the screen, and a finger can work the controls without
// leaving their tips standing.

import { expect, test, type Page } from '@playwright/test';

/** What lies at each pocket's centre and at the cue ball: it must be the table itself. */
async function covered(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const marks = window.__poolDebug!.landmarks();
    const points = [...marks.pockets, ...(marks.cueBall ? [marks.cueBall] : [])];
    return points
      .map((p) => {
        const e = document.elementFromPoint(p.x, p.y);
        const onScreen = p.x >= 0 && p.y >= 0 && p.x <= innerWidth && p.y <= innerHeight;
        return !onScreen ? `off screen at ${Math.round(p.x)},${Math.round(p.y)}` : e?.className;
      })
      .filter((name) => name !== 'scene-canvas') as string[];
  });
}

/** Waits until the camera has come to rest. */
async function settle(page: Page) {
  await page.waitForTimeout(150);
  await expect
    .poll(() => page.evaluate(() => window.__poolDebug!.cameraSettled()), { timeout: 15000 })
    .toBe(true);
}

/** Parts of the interface reaching past the screen's edges. */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '.hud-top, .hud-dock, .power, .status, .fine-aim, .spin, .player-card, .hud-buttons',
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
