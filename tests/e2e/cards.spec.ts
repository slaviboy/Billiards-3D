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

// Large player cards, for video calls: beside the table on a computer, a tablet or a phone on its
// side, side by side under the buttons on a phone held upright. With a picture on both cards and
// the widest row of balls, nothing spills off the screen or over the other controls, the pictures
// are large, and the pockets and the cue ball stay in sight. The switch in Settings moves the
// cards, and a picture playing goes with them.

import { expect, test, type Page } from '@playwright/test';

const LARGE = { largeCards: true };

async function startMatch(page: Page, settings: object = LARGE) {
  await page.addInitScript((s) => {
    localStorage.setItem('pool.settings.v2', JSON.stringify(s));
  }, settings);
  await page.goto('./');
  await expect(page.locator('#app[data-ready="true"]')).toBeAttached();
  await page.locator('.mode-card[data-mode="local"]').click();
  await page.getByRole('button', { name: 'Start' }).click();
  // The second player has cleared the stripes, so the 8 joins their row: the widest it gets.
  await page.evaluate(() =>
    window.__poolDebug!.arrange({
      groups: [1, 2],
      turn: 0,
      onTable: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    }),
  );
}

/**
 * What the online play does when pictures arrive, for the second player at this device: a picture
 * on each card, the second player's microphone and camera switches beside that widest row, and the
 * first player's speaker switch.
 */
async function showPictures(page: Page) {
  await page.evaluate(() => {
    for (const seat of [0, 1]) {
      const card = document.querySelector<HTMLElement>(`[data-testid="player-${seat}"]`)!;
      const video = card.querySelector('video')!;
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const g = canvas.getContext('2d')!;
      video.srcObject = canvas.captureStream(10);
      setInterval(() => {
        g.fillStyle = seat ? '#a5563a' : '#3a6ea5';
        g.fillRect(0, 0, 640, 480);
      }, 100);
      video.hidden = false;
      void video.play();
      card.classList.add('video-on');
      const controls = card.querySelector<HTMLElement>('.card-media')!;
      controls.hidden = false;
      const [mic, cam, speaker] = [...controls.querySelectorAll('button')];
      mic!.hidden = seat !== 1;
      cam!.hidden = seat !== 1;
      speaker!.hidden = seat === 1;
      controls.querySelector<HTMLElement>('.card-media-silent')!.hidden = true;
    }
  });
}

/** Waits until the camera has come to rest. */
async function settle(page: Page) {
  await page.waitForTimeout(150);
  await expect
    .poll(() => page.evaluate(() => window.__poolDebug!.cameraSettled()), { timeout: 15000 })
    .toBe(true);
}

/** Everything wrong with the layout: parts off the screen, over each other, or cut short. */
async function problems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const box = (selector: string) =>
      [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed')
        .map((e) => ({ name: selector, r: e.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0);
    const cards = [...box('[data-testid="player-0"]'), ...box('[data-testid="player-1"]')];
    const others = [...box('.hud-top'), ...box('.hud-dock'), ...box('.power')];
    for (const { name, r } of [...cards, ...others]) {
      if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) {
        found.push(`${name} off the screen`);
      }
    }
    const over = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    for (const [i, a] of cards.entries()) {
      for (const b of [...cards.slice(i + 1), ...others]) {
        if (over(a.r, b.r)) found.push(`${a.name} over ${b.name}`);
      }
    }
    for (const row of document.querySelectorAll<HTMLElement>('.player-card .player-balls')) {
      if (row.scrollWidth > row.clientWidth + 1) found.push('a row of balls cut short');
    }
    return found;
  });
}

/** What lies at each pocket's centre and at the cue ball: it must be the table itself. */
async function covered(page: Page): Promise<string[]> {
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

for (const [name, width, height, touch, upright] of [
  ['a computer', 1174, 880, false, false],
  ['a tablet held upright', 820, 1180, true, false],
  ['a phone held upright', 390, 844, true, true],
  ['a phone on its side', 844, 390, true, false],
] as const) {
  test.describe(`large cards on ${name}`, () => {
    test.use({ viewport: { width, height }, hasTouch: touch, isMobile: touch });

    test('fit with pictures, and leave the table in sight', async ({ page }) => {
      await startMatch(page);
      await showPictures(page);
      await settle(page);
      expect(await problems(page)).toEqual([]);
      expect(await covered(page)).toEqual([]);

      const first = (await page.getByTestId('player-0').boundingBox())!;
      const second = (await page.getByTestId('player-1').boundingBox())!;
      if (upright) {
        expect(second.x).toBeGreaterThanOrEqual(first.x + first.width);
        expect(second.y).toBe(first.y);
      } else {
        expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
        expect(first.x + first.width).toBeLessThan(width / 3);
      }
      for (const seat of [0, 1]) {
        const picture = (await page.getByTestId(`player-${seat}`).locator('video').boundingBox())!;
        expect(picture.width).toBeGreaterThanOrEqual(160);
        expect(picture.height).toBeGreaterThanOrEqual(90);
      }
    });
  });
}

test('the switch in Settings moves the cards, the picture playing with them', async ({ page }) => {
  await startMatch(page, {});
  await showPictures(page);
  const card = page.getByTestId('player-0');
  const video = card.locator('video');
  await expect(page.locator('.hud-top [data-testid="player-0"]')).toBeAttached();
  await expect(card.locator('.player-avatar video')).toBeAttached();

  const largeSwitch = async (on: boolean) => {
    await page.getByRole('button', { name: 'Menu (Esc)' }).click();
    await page.locator('.pause-item[data-choice="settings"]').click();
    const toggle = page.getByRole('switch', { name: 'Large player cards, for video calls' });
    await toggle.setChecked(on);
    await page.keyboard.press('Escape');
    await expect(page.locator('.dialog')).toHaveCount(0);
  };

  await largeSwitch(true);
  await expect(page.locator('.hud-players [data-testid="player-0"]')).toBeAttached();
  await expect(card.locator(':scope > video')).toBeAttached();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  expect((await video.boundingBox())!.width).toBeGreaterThan(200);

  await largeSwitch(false);
  await expect(page.locator('.hud-top [data-testid="player-0"]')).toBeAttached();
  await expect(card.locator('.player-avatar video')).toBeAttached();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('pool.settings.v2'))).toContain(
    '"largeCards":false',
  );
});
