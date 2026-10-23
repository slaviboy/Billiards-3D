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

// The guide behind the (i) button: on a computer and on a phone it labels every part of the
// screen that shows, each label on the screen and none over another, and a tap, a click or
// Escape closes it.

import { expect, test, type Page } from '@playwright/test';

async function startMatch(page: Page) {
  await page.goto('./');
  await expect(page.locator('#app[data-ready="true"]')).toBeAttached();
  await page.locator('.mode-card[data-mode="local"]').click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.dialog')).toHaveCount(0);
}

const PARTS = ['Spin', 'Fine aim', 'Cue', 'Status', 'Power', 'Aim and the view', 'Players'];

for (const [name, width, height, touch, extra] of [
  ['a computer', 1174, 880, false, ['Menus', 'New game', 'View']],
  ['a phone held upright', 390, 844, true, ['Menus', 'View']],
] as const) {
  test.describe(`the guide on ${name}`, () => {
    test.use({ viewport: { width, height }, hasTouch: touch, isMobile: touch });

    test('labels every part, keeps its labels apart and on the screen, and closes', async ({
      page,
    }) => {
      await startMatch(page);
      await page.getByRole('button', { name: 'What each part does' }).click();
      const guide = page.getByRole('dialog', { name: 'What each part does' });
      await expect(guide).toBeVisible();
      for (const title of [...PARTS, ...extra]) {
        await expect(guide.getByText(title, { exact: true })).toBeVisible();
      }

      const boxes = await guide
        .locator('.guide-label')
        .evaluateAll((labels) => labels.map((l) => l.getBoundingClientRect().toJSON() as DOMRect));
      for (const b of boxes) {
        expect(b.left).toBeGreaterThanOrEqual(0);
        expect(b.top).toBeGreaterThanOrEqual(0);
        expect(b.right).toBeLessThanOrEqual(width);
        expect(b.bottom).toBeLessThanOrEqual(height);
      }
      for (const [i, a] of boxes.entries()) {
        for (const b of boxes.slice(i + 1)) {
          const apart =
            a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
          expect(apart).toBe(true);
        }
      }

      if (touch) await guide.tap({ position: { x: 20, y: height / 2 } });
      else await page.keyboard.press('Escape');
      await expect(guide).toBeHidden();
    });
  });
}
