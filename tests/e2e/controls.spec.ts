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

// The camera and the aim with the mouse and the keyboard, as on the chess board: a rail's corner
// turns the view, a rail's side pans it, the wheel zooms, Home brings it back, T switches to the
// top view; the cloth aims; none of it touches the game. Each shot starts from no power, and a pull
// taken back to the start of the power bar shoots nothing. The hints on hover are off until
// turned on.

import { expect, test, type Page } from '@playwright/test';

const debug = <T>(page: Page, f: () => T) => page.evaluate(f);
const camera = (page: Page) => page.evaluate(() => window.__poolDebug!.camera());
/** A table point at the height of the balls' centres, where the cloth is aimed at. */
const at = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => window.__poolDebug!.toClient(x!, y!, 0.028575), [x, y]);
const W = 1.27; // the 9-foot table's playing width
const L = 2.54;

/** The first of these table points that shows on the canvas clear of the interface. */
async function visible(page: Page, points: [number, number][]) {
  const size = page.viewportSize()!;
  for (const [x, y] of points) {
    const p = await at(page, x, y);
    const free = await page.evaluate(
      ([px, py]) =>
        document.elementFromPoint(px!, py!)?.classList.contains('scene-canvas') ?? false,
      [p.x, p.y],
    );
    if (free && p.x > 20 && p.y > 20 && p.x < size.width - 20 && p.y < size.height - 20) return p;
  }
  throw new Error('none of the points is on screen');
}

/** Points in the middle of each rail. */
const RAIL_SIDES: [number, number][] = [
  [W / 2, -0.08],
  [-0.08, L / 4],
  [W + 0.08, L / 4],
  [-0.08, (3 * L) / 4],
  [W + 0.08, (3 * L) / 4],
  [W / 2, L + 0.08],
];

/** Waits until the camera has come to rest (the software renderer draws slowly). */
async function settle(page: Page) {
  await page.waitForTimeout(150);
  await expect
    .poll(() => page.evaluate(() => window.__poolDebug!.cameraSettled()), { timeout: 15000 })
    .toBe(true);
}

/** The camera's tilt above the cloth, seen from the point it looks at (the table's middle). */
const tilt = (c: { x: number; y: number; z: number }) => Math.atan2(c.y, Math.hypot(c.x, c.z));

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto('./?menu=0');
  await expect(page.locator('#app[data-ready="true"]')).toBeAttached();
  await settle(page);
});

test('the mouse turns, zooms and pans the view without touching the game', async ({ page }) => {
  const hash = await debug(page, () => window.__poolDebug!.hash());
  const home = await camera(page);
  const canvas = page.locator('canvas.scene-canvas');

  // Hovering a rail corner offers to turn, a rail side to pan.
  const corner = await at(page, -0.08, -0.08);
  await page.mouse.move(corner.x, corner.y);
  await expect(canvas).toHaveCSS('cursor', /grab/);
  const side = await at(page, W / 2, -0.08);
  await page.mouse.move(side.x, side.y);
  await expect(canvas).toHaveCSS('cursor', /move/);

  await drag(page, corner, 180, 0);
  await settle(page);
  const turned = await camera(page);
  expect(Math.hypot(turned.x - home.x, turned.z - home.z)).toBeGreaterThan(0.3);
  expect(tilt(turned)).toBeCloseTo(tilt(home), 2);

  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -600);
  await settle(page);
  const zoomed = await camera(page);
  const length = (c: { x: number; y: number; z: number }) => Math.hypot(c.x, c.y, c.z);
  expect(length(zoomed)).toBeLessThan(length(turned) * 0.8);

  const rail = await visible(page, RAIL_SIDES);
  await drag(page, rail, -120, -40);
  await page.waitForTimeout(200);
  const panned = await camera(page);
  expect(Math.hypot(panned.x - zoomed.x, panned.z - zoomed.z)).toBeGreaterThan(0.05);

  // Right-drag turns from anywhere.
  await page.mouse.move(640, 300);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(520, 300, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await settle(page);
  expect((await camera(page)).x).not.toBeCloseTo(panned.x, 2);

  await page.keyboard.press('Home');
  await settle(page);
  const back = await camera(page);
  expect(back.x).toBeCloseTo(home.x, 2);
  expect(back.y).toBeCloseTo(home.y, 2);
  expect(back.z).toBeCloseTo(home.z, 2);
  expect(await debug(page, () => window.__poolDebug!.hash())).toBe(hash);
});

test('the keys move the camera as on the chess board', async ({ page }) => {
  const home = await camera(page);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await settle(page);
  expect((await camera(page)).x).not.toBeCloseTo(home.x, 2);
  await page.keyboard.press('ArrowUp');
  await settle(page);
  await page.keyboard.press('PageUp');
  await settle(page);
  await page.keyboard.press('Home');
  await settle(page);
  expect((await camera(page)).z).toBeCloseTo(home.z, 2);

  // F looks from the other end.
  await page.keyboard.press('f');
  await settle(page);
  expect(Math.sign((await camera(page)).z)).toBe(-Math.sign(home.z));
  await page.keyboard.press('f');
  await settle(page);

  // T: the top view, zoomed with PgUp and turned with the arrows; T again: back to 3D.
  await page.keyboard.press('t');
  await settle(page);
  expect(await debug(page, () => window.__poolDebug!.view())).toBe('top');
  const top = await camera(page);
  expect(top.zoom).toBeGreaterThan(0);
  await page.keyboard.press('PageUp');
  await page.keyboard.press('ArrowLeft');
  await settle(page);
  const turnedTop = await camera(page);
  expect(turnedTop.zoom).toBeLessThan(top.zoom);
  expect(turnedTop.upX).not.toBeCloseTo(top.upX, 3);
  await page.keyboard.press('t');
  await settle(page);
  expect(await debug(page, () => window.__poolDebug!.view())).toBe('3d');
});

test('in the top view a drag round the table turns it one way all the way round', async ({
  page,
}) => {
  await page.keyboard.press('t');
  await settle(page);
  // Round the point the view turns about (the table's middle), clockwise on screen, a full turn,
  // right button down so the drag turns wherever it passes.
  const centre = await at(page, W / 2, L / 2);
  const radius = Math.min(page.viewportSize()!.width, page.viewportSize()!.height) * 0.3;
  const point = (a: number) => ({
    x: centre.x + radius * Math.cos(a),
    y: centre.y + radius * Math.sin(a),
  });
  // Where a corner of the table lies on screen, as an angle round the middle (clockwise).
  const corner = async () => {
    const p = await at(page, 0, 0);
    return Math.atan2(p.y - centre.y, p.x - centre.x);
  };
  await page.mouse.move(point(0).x, point(0).y);
  await page.mouse.down({ button: 'right' });
  let last = await corner();
  let turned = 0;
  // Twelve steps of 30°: the software renderer takes seconds to settle after each.
  for (let k = 1; k <= 12; k++) {
    const p = point((k * 2 * Math.PI) / 12);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await settle(page);
    const now = await corner();
    const step = Math.atan2(Math.sin(now - last), Math.cos(now - last));
    // Every part of the circle turns the table the way the hand goes, as far as it went.
    expect(step, `step ${k}`).toBeGreaterThan(0.4);
    turned += step;
    last = now;
  }
  await page.mouse.up({ button: 'right' });
  expect(turned).toBeCloseTo(2 * Math.PI, 1);
});

test('the cloth aims with the mouse, Shift and the arrows aim, I J K L spin', async ({ page }) => {
  const cue = await debug(page, () => window.__poolDebug!.cueBall());
  // Press on the cloth to the cue ball's right: the cue points there.
  const target = await at(page, cue.x + 0.4, cue.y);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.up();
  const aimed = await debug(page, () => window.__poolDebug!.aim());
  expect(Math.abs(aimed.heading)).toBeLessThan(0.02);

  await page.keyboard.press('Shift+ArrowLeft');
  const turned = await debug(page, () => window.__poolDebug!.aim());
  expect(turned.heading).toBeGreaterThan(aimed.heading);

  await page.keyboard.press('Shift+ArrowUp');
  expect((await debug(page, () => window.__poolDebug!.aim())).power).toBeCloseTo(
    aimed.power + 0.05,
    5,
  );
  await page.keyboard.press('j');
  await page.keyboard.press('i');
  const spun = await debug(page, () => window.__poolDebug!.aim());
  expect(spun.a).toBeGreaterThan(0);
  expect(spun.b).toBeGreaterThan(0);
  await page.keyboard.press('c');
  expect((await debug(page, () => window.__poolDebug!.aim())).a).toBe(0);

  // The far end of the cloth: aiming up the table.
  const far = await at(page, cue.x, L - 0.3);
  await page.mouse.move(far.x, far.y);
  await page.mouse.down();
  await page.mouse.up();
  expect((await debug(page, () => window.__poolDebug!.aim())).heading).toBeCloseTo(Math.PI / 2, 1);
});

test('the shortcuts list opens with ? and lists the camera keys', async ({ page }) => {
  await page.keyboard.press('Shift+?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard and mouse' });
  await expect(dialog).toBeVisible();
  for (const text of ['Drag a rail corner', 'Drag a rail side', 'PgUp / PgDn', 'Home']) {
    await expect(dialog).toContainText(text);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('each shot starts from no power, and a pull taken back to the start shoots nothing', async ({
  page,
}) => {
  const power = page.getByTestId('power');
  const state = () =>
    page.evaluate(() => ({
      power: window.__poolDebug!.aim().power,
      shot: window.__poolDebug!.match().shot,
    }));
  expect(await state()).toEqual({ power: 0, shot: 0 });
  await expect(power).toHaveClass(/idle/);
  await expect(power).toContainText('Pull');

  // Space alone shoots nothing, and says how to set the power.
  await page.keyboard.press('Space');
  await expect(page.locator('.toast', { hasText: 'Pull the power bar down' })).toBeVisible();
  expect((await state()).shot).toBe(0);

  // A pull, then back to the start: the bar says so, and letting go there shoots nothing.
  const track = (await page.locator('.power-track').boundingBox())!;
  const x = track.x + track.width / 2;
  await page.mouse.move(x, track.y + 2);
  await page.mouse.down();
  await page.mouse.move(x, track.y + track.height * 0.7, { steps: 8 });
  expect((await state()).power).toBeCloseTo(0.7, 1);
  // The colour keeps up with the grip: the fill ends where the pull is, at once.
  const fillEnd = await page
    .locator('.power-fill')
    .evaluate((e) => e.getBoundingClientRect().bottom);
  expect(Math.abs(fillEnd - (track.y + track.height * 0.7))).toBeLessThan(3);
  await expect(power).not.toHaveClass(/cancelling/);
  await page.mouse.move(x, track.y + 2, { steps: 8 });
  await expect(power).toHaveClass(/cancelling/);
  await expect(power).toContainText('Cancel');
  await page.mouse.up();
  await expect(power).toHaveClass(/idle/);
  expect(await state()).toEqual({ power: 0, shot: 0 });

  // A pull let go further down shoots, and the next shot starts from no power again.
  await page.evaluate(() => window.__poolDebug!.setPlaybackSpeed(8));
  await page.mouse.move(x, track.y + 2);
  await page.mouse.down();
  await page.mouse.move(x, track.y + track.height * 0.4, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await state()).shot, { timeout: 20000 }).toBe(1);
  await expect(power).toHaveClass(/idle/, { timeout: 20000 });
  expect((await state()).power).toBe(0);
});

test('the dock names its parts, reads the spin in words, centres it and aims in steps', async ({
  page,
}) => {
  const dock = page.locator('.hud-dock');
  for (const name of ['Spin', 'Aim', 'Cue']) {
    await expect(dock.getByRole('region', { name })).toBeVisible();
  }
  await expect(page.locator('.status-pill')).toBeVisible();

  const spin = page.getByTestId('spin');
  await expect(spin).toContainText('Stun');
  await expect(spin).toContainText('No side');
  for (let i = 0; i < 5; i++) await page.keyboard.press('i');
  await expect(spin).toContainText('Top ¼');
  await page.getByRole('button', { name: 'Strike the centre (C)' }).click();
  await expect(spin).toContainText('Stun');
  expect(await debug(page, () => window.__poolDebug!.aim().b)).toBe(0);

  const before = (await debug(page, () => window.__poolDebug!.aim())).heading;
  await page.getByRole('button', { name: 'Aim a touch left (,)' }).click();
  const after = (await debug(page, () => window.__poolDebug!.aim())).heading;
  expect(after - before).toBeCloseTo((0.05 * Math.PI) / 180, 6);
});

test('the hints on hover are off until turned on', async ({ page }) => {
  const tip = () =>
    page.evaluate(() => getComputedStyle(document.querySelector('.power')!, '::after').content);
  await page.locator('.power').hover();
  await expect.poll(tip).toBe('none');

  await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
  await page.locator('.menu-entry', { hasText: 'Hints on hover' }).click();
  await page.locator('.power').hover();
  await expect.poll(tip).toBe('"Pull down and let go to shoot"');
  expect(await page.evaluate(() => localStorage.getItem('pool.settings.v2'))).toContain(
    '"hints":true',
  );
});
