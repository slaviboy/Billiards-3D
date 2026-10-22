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

// Both views look at the same game: switching between the 3D and the top view moves only the
// camera. And a shot played in the browser ends exactly where Node's simulation of the same shot
// does.

import { expect, test } from '@playwright/test';
import { MatchController } from '../../src/game/MatchController.ts';
import { encodePlacement } from '../../src/game/shotCodec.ts';

const BREAK = { yaw: Math.round(0.25 * (1 << 20)), pitch: 30, speed: 6500, a: 0, b: -100 };

test.beforeEach(async ({ page }) => {
  await page.goto('./?menu=0');
  await expect(page.locator('#app[data-ready="true"]')).toBeAttached();
});

test('switching views keeps the game as it is', async ({ page }) => {
  const before = await page.evaluate(() => window.__poolDebug!.hash());
  for (const view of ['top', '3d', 'top', '3d'] as const) {
    await page.evaluate((v) => window.__poolDebug!.setView(v), view);
    await page.waitForTimeout(1100);
    expect(await page.evaluate(() => window.__poolDebug!.view())).toBe(view);
    expect(await page.evaluate(() => window.__poolDebug!.hash())).toBe(before);
  }
});

test('a break in the browser ends exactly as Node simulates it', async ({ page }) => {
  // The table the page opens with: practice on the 9-foot table, racked from the seed 'welcome'.
  const match = new MatchController({
    mode: 'practice',
    size: '9ft',
    race: 1,
    shotClock: 0,
    names: ['Player 1', 'Player 2'],
    seed: 'welcome',
    firstBreak: 0,
  });
  // The cue ball is in hand, so the page sends its place with the shot, as it would online.
  const cue = match.current.balls[0]!;
  match.shoot(BREAK, { pocket: null, safety: false }, encodePlacement(cue.rx, cue.ry));
  const expected = match.hash();
  await page.evaluate(() => window.__poolDebug!.setPlaybackSpeed(8));
  const hash = await page.evaluate((code) => window.__poolDebug!.shoot(code), BREAK);
  expect(hash).toBe(expected);
});
