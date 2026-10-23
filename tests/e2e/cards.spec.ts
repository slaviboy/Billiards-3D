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
// are large, and the pockets and the cue ball stay in sight. Small cards in a call on a phone held
// upright grow the top bar for 4:3 windows the pictures fill. The switch in Settings moves the
// cards, and a picture playing goes with them.

import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { covered, settle } from '../support/screen.ts';

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
 * on each card (or on those of `seats`), 4:3 as a computer's camera gives or 3:4 as a phone's held
 * upright does, the second player's microphone and camera switches beside that widest row, and
 * the first player's speaker switch.
 */
async function showPictures(page: Page, seats: readonly number[] = [0, 1], upright = false) {
  await page.evaluate(
    ([seats, upright]) => {
      for (const seat of seats) {
        const card = document.querySelector<HTMLElement>(`[data-testid="player-${seat}"]`)!;
        const video = card.querySelector('video')!;
        const canvas = document.createElement('canvas');
        canvas.width = upright ? 480 : 640;
        canvas.height = upright ? 640 : 480;
        const g = canvas.getContext('2d')!;
        video.srcObject = canvas.captureStream(10);
        setInterval(() => {
          g.fillStyle = seat ? '#a5563a' : '#3a6ea5';
          g.fillRect(0, 0, canvas.width, canvas.height);
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
    },
    [seats, upright] as const,
  );
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
    const others = [
      ...box('.hud-top'),
      ...box('.status-pill'),
      ...box('.hud-dock'),
      ...box('.power'),
    ];
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

// A tablet and a computer have the menu bar over the cards by default; a phone has it if chosen.
for (const [name, width, height, touch, upright, settings] of [
  ['a computer', 1174, 880, false, false, LARGE],
  ['a tablet held upright', 820, 1180, true, false, LARGE],
  ['a phone held upright', 390, 844, true, true, LARGE],
  ['a phone held upright, with the menu bar', 390, 844, true, true, { ...LARGE, menuBar: true }],
  ['a phone on its side', 844, 390, true, false, LARGE],
] as const) {
  test.describe(`large cards on ${name}`, () => {
    test.use({ viewport: { width, height }, hasTouch: touch, isMobile: touch });

    test('fit with pictures, and leave the table in sight', async ({ page }) => {
      await startMatch(page, settings);
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

// Small cards on a phone held upright: in a call the top bar grows, each picture a 4:3 window as
// wide as the card and filled by the picture, whatever the camera's shape, with the name and the
// balls on its foot; the initial in the window of a player without a camera.
test.describe('a video call on a phone held upright, the cards in the top bar', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const SMALL = { largeCards: false, menuBar: false };

  /** Each card's window, its name and its balls, and where the bar ends. */
  async function layout(page: Page) {
    return page.evaluate(() => {
      const box = (e: Element) => e.getBoundingClientRect().toJSON() as DOMRect;
      const bar = box(document.querySelector('.hud-top')!);
      const cards = [0, 1].map((seat) => {
        const card = document.querySelector(`[data-testid="player-${seat}"]`)!;
        const name = card.querySelector<HTMLElement>('.player-name')!;
        const balls = card.querySelector<HTMLElement>('.player-balls')!;
        const initial = card.querySelector<HTMLElement>('.player-initial')!;
        return {
          window: box(card.querySelector('.player-avatar')!),
          name: box(name),
          balls: box(balls),
          cut: name.scrollWidth > name.clientWidth + 1 || balls.scrollWidth > balls.clientWidth + 1,
          initial: getComputedStyle(initial).display !== 'none',
        };
      });
      return { bar, cards };
    });
  }

  test('shows each picture filling a 4:3 window, the name and the balls on its foot', async ({
    page,
  }) => {
    await startMatch(page, SMALL);
    // Phones' cameras held upright: pictures taller than wide, cropped to the window.
    await showPictures(page, [0, 1], true);
    await settle(page);
    expect(await covered(page)).toEqual([]);
    const { bar, cards } = await layout(page);
    expect(bar.right).toBeLessThanOrEqual(390);
    expect(bar.height).toBeLessThanOrEqual(150);
    for (const [seat, card] of cards.entries()) {
      const { window, name, balls } = card;
      expect(window.width).toBeGreaterThanOrEqual(140);
      expect(Math.abs(window.height - (window.width * 3) / 4)).toBeLessThanOrEqual(1);
      expect(name.top).toBeGreaterThanOrEqual(window.top + window.height / 2);
      expect(balls.top).toBeGreaterThanOrEqual(name.bottom - 1);
      expect(balls.bottom).toBeLessThanOrEqual(window.bottom);
      expect(name.left).toBeGreaterThanOrEqual(window.left);
      expect(name.right).toBeLessThanOrEqual(window.right);
      expect(card.cut).toBe(false);
      // The picture reaches the window's sides: no dark bars beside it, above the band.
      const video = page.getByTestId(`player-${seat}`).locator('video');
      const picture = (await video.boundingBox())!;
      expect(picture.width).toBeGreaterThanOrEqual(window.width - 10);
      const png = PNG.sync.read(await video.screenshot());
      const colour = seat ? [0xa5, 0x56, 0x3a] : [0x3a, 0x6e, 0xa5];
      const y = Math.round(png.height * 0.3);
      for (const x of [4, png.width - 5]) {
        const i = (y * png.width + x) * 4;
        for (const [c, value] of colour.entries()) {
          expect(Math.abs(png.data[i + c]! - value)).toBeLessThanOrEqual(24);
        }
      }
    }
  });

  test("with one camera on, shows the other player's initial in a window alike", async ({
    page,
  }) => {
    await startMatch(page, SMALL);
    const before = await layout(page);
    expect(before.cards[0]!.window.width).toBeLessThan(50);
    await showPictures(page, [1]);
    const { cards } = await layout(page);
    expect(cards[0]!.window.width).toBeGreaterThanOrEqual(140);
    expect(cards[0]!.window.width).toBeCloseTo(cards[1]!.window.width, 0);
    expect(cards[0]!.window.height).toBeCloseTo(cards[1]!.window.height, 0);
    expect(cards[0]!.initial).toBe(true);
    expect(cards[1]!.initial).toBe(false);
  });
});

test('the switch in Settings moves the cards, the picture playing with them', async ({ page }) => {
  await startMatch(page, { largeCards: false, menuBar: false });
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
