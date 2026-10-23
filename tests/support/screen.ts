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

// What end-to-end tests ask of the screen: that the camera has come to rest, and that the
// interface leaves the table's pockets and the cue ball in sight.

import { expect, type Page } from '@playwright/test';

/** Waits until the camera has come to rest. */
export async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(150);
  await expect
    .poll(() => page.evaluate(() => window.__poolDebug!.cameraSettled()), { timeout: 15000 })
    .toBe(true);
}

/**
 * What lies at each pocket's centre and at the cue ball, where it is not the table itself: the
 * class of the element over it, or where it is off the screen. Empty when all are in sight.
 */
export async function covered(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const marks = window.__poolDebug!.landmarks();
    const points = [...marks.pockets, ...(marks.cueBall ? [marks.cueBall] : [])];
    return points
      .map((p) => {
        const e = document.elementFromPoint(p.x, p.y);
        const onScreen = p.x >= 0 && p.y >= 0 && p.x <= innerWidth && p.y <= innerHeight;
        if (!onScreen) return `off screen at ${Math.round(p.x)},${Math.round(p.y)}`;
        return e?.getAttribute('class') ?? e?.tagName;
      })
      .filter((name) => name !== 'scene-canvas') as string[];
  });
}
