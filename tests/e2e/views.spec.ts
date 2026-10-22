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
import { decodeShot } from '../../src/game/shotCodec.ts';
import { simulate, stateHash } from '../../src/physics/index.ts';
import { buildTable } from '../../src/table/geometry.ts';
import { rackBalls, seedFrom } from '../../src/table/rack.ts';
import { tableSpec } from '../../src/table/spec.ts';

const BREAK = { yaw: Math.round(0.25 * (1 << 20)), pitch: 30, speed: 6500, a: 0, b: -100 };

test.beforeEach(async ({ page }) => {
  await page.goto('./');
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
  const table = buildTable(tableSpec('9ft'));
  const expected = stateHash(
    simulate(rackBalls(table, seedFrom('practice')), decodeShot(BREAK), table.physics).final,
  );
  await page.evaluate(() => window.__poolDebug!.setPlaybackSpeed(8));
  const hash = await page.evaluate((code) => window.__poolDebug!.shoot(code), BREAK);
  expect(hash).toBe(expected);
});
