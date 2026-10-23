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

// Two players in two browser windows, connected from an invitation link over the real network
// (public Nostr relays find the two, then WebRTC connects them directly). These tests need the
// internet, so they are kept out of CI. The development hook is gone during an online game, so the
// players shoot from the keyboard, and the tables' fingerprints are read from the connection chip.

import { expect, test, type Browser, type Page } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

/** Addresses and connection details that must never reach the console. */
const LEAKS = [
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
  /\b(?:[0-9a-f]{1,4}:){3,}[0-9a-f]{0,4}\b/i,
  /candidate:/i,
  /\bv=0\b|a=ice-|a=fingerprint/,
];

test.skip(!!process.env.CI, 'needs the internet: public relays introduce the two players');
// Chromium's own test camera and microphone, allowed without a prompt.
test.use({
  launchOptions: {
    args: [
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  },
});
// The relays are public and sometimes slow to introduce the two, and two 3D pages in software
// rendering load a busy machine: a generous limit, and one more try before failing.
test.describe.configure({ timeout: 360_000, retries: 1 });

/** Counts peer connections and sockets from the first script on, before the game's own code. */
async function countNetwork(page: Page) {
  await page.addInitScript(() => {
    const counts = { peers: 0, sockets: 0, devices: 0 };
    const ask = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (ask) {
      navigator.mediaDevices.getUserMedia = (constraints) => {
        counts.devices++;
        return ask(constraints);
      };
    }
    (window as unknown as { __testNetwork: typeof counts }).__testNetwork = counts;
    const Peer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer {
      constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
        super(...args);
        counts.peers++;
      }
    };
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket {
      constructor(...args: ConstructorParameters<typeof WebSocket>) {
        super(...args);
        counts.sockets++;
      }
    };
  });
}

const network = (page: Page) =>
  page.evaluate(() => {
    const { peers, sockets } = (
      window as unknown as { __testNetwork: { peers: number; sockets: number } }
    ).__testNetwork;
    return { peers, sockets };
  });

const deviceRequests = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __testNetwork: { devices: number } }).__testNetwork.devices,
  );

/**
 * A player's window, at the main menu (or at an invitation); `clockMs` sets its clock that far off
 * the real time, as a drifted device's.
 */
async function player(browser: Browser, url = './', clockMs = 0) {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (clockMs) {
    await page.addInitScript((offset) => {
      const now = Date.now.bind(Date);
      Date.now = () => now() + offset;
    }, clockMs);
  }
  const errors: string[] = [];
  const logs: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    logs.push(m.text());
    // A public relay that is down or busy is the browser's complaint, not the game's.
    if (m.type() === 'error' && !/WebSocket connection to 'wss:/.test(m.text())) {
      errors.push(m.text());
    }
  });
  await countNetwork(page);
  await page.goto(url);
  await expect(page.locator('#app[data-ready="true"]')).toBeAttached({ timeout: 60_000 });
  return { page, errors, logs, chip: page.getByTestId('online') };
}

type Side = Awaited<ReturnType<typeof player>>;

async function accept(page: Page, title: string, name: string, button: string) {
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  const go = dialog.getByRole('button', { name: button, exact: true });
  const box = dialog.getByRole('checkbox');
  await expect(box).not.toBeChecked();
  await expect(go).toBeDisabled();
  await dialog.getByRole('textbox').fill(name);
  await box.check();
  await expect(go).toBeEnabled();
  await go.click();
}

/** The host asks for an online match (the host breaking first) and returns the link. */
async function createLink(page: Page, shotClock = 'Off', guide = 'On'): Promise<string> {
  await page.locator('.mode-card[data-mode="online"]').click();
  const terms = page.getByRole('dialog', { name: 'Play a friend online' });
  await terms.getByRole('radio', { name: 'You', exact: true }).click();
  const choose = (group: string, name: string) =>
    terms
      .getByRole('radiogroup', { name: group })
      .getByRole('radio', { name, exact: true })
      .click();
  await choose('Shot clock', shotClock);
  await choose('Aiming guide', guide);
  const before = await network(page);
  await terms.getByRole('button', { name: 'Continue' }).click();
  // Nothing new may connect while the warning is up.
  await expect(page.getByRole('dialog', { name: 'Play a friend online' })).toContainText(
    'Before you play online',
  );
  expect(await network(page)).toEqual(before);
  await accept(page, 'Play a friend online', 'Ana', 'Create link');
  const field = page.getByRole('textbox', { name: 'Game link' });
  await expect(field).toHaveValue(/^http:\/\/localhost:\d+\/#g=[A-Za-z0-9_-]{22}$/);
  return field.inputValue();
}

/** Both players connected: the host's invitation and the guest's wait have closed. */
async function connect(browser: Browser) {
  const host = await player(browser);
  const link = await createLink(host.page);
  const guest = await player(browser, link);
  return { host, guest, link };
}

async function joinAs(guest: Side, host: Side) {
  await accept(guest.page, 'Join an online game', 'Ben', 'Join game');
  await expect(host.page.getByRole('dialog', { name: 'Invite a friend' })).toHaveCount(0, {
    timeout: 150_000,
  });
  for (const side of [host, guest]) {
    await expect(side.chip).toHaveAttribute('data-status', 'playing', { timeout: 30_000 });
  }
}

/** Lets go of the focus, so that Space shoots rather than pressing a button. */
const unfocus = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

/** The chip's view of the match on one side. */
const view = async (side: Side) => ({
  shot: Number(await side.chip.getAttribute('data-shot')),
  hash: await side.chip.getAttribute('data-hash'),
  turn: Number(await side.chip.getAttribute('data-turn')),
  phase: await side.chip.getAttribute('data-phase'),
  seat: Number(await side.chip.getAttribute('data-seat')),
});

/** Waits until both sides have played `shots` shots and have the same table. */
async function agree(host: Side, guest: Side, shots: number) {
  for (const side of [host, guest]) {
    await expect(side.chip).toHaveAttribute('data-shot', String(shots), { timeout: 60_000 });
  }
  await expect
    .poll(async () => (await view(guest)).hash, { timeout: 10_000 })
    .toBe((await view(host)).hash);
  expect((await view(host)).hash).toMatch(/^[0-9a-f]{16}$/);
}

test('two players connect from a link, play the break and a shot, and agree on the table', async ({
  browser,
}) => {
  const host = await player(browser);
  const link = await createLink(host.page);
  // The link carries the page and the secret only, and its QR code reads back to it.
  expect(new URL(link).search).toBe('');
  const qr = host.page.locator('.online-qr-code');
  await expect(qr).toBeVisible();
  await host.page
    .getByRole('dialog', { name: 'Invite a friend' })
    .evaluate((d) => Promise.all(d.getAnimations({ subtree: true }).map((a) => a.finished)));
  const png = PNG.sync.read(await qr.screenshot());
  expect(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data).toBe(link);

  const guest = await player(browser, link);
  // The link leaves the address bar at once, and nothing connects before the warning is accepted.
  await expect(guest.page.getByRole('dialog', { name: 'Join an online game' })).toBeVisible();
  expect(new URL(guest.page.url()).hash).toBe('');
  expect(await network(guest.page)).toEqual({ peers: 0, sockets: 0 });
  await joinAs(guest, host);
  expect((await network(guest.page)).peers).toBeGreaterThan(0);
  expect(await view(host)).toMatchObject({ seat: 0, shot: 0, turn: 0, phase: 'break' });
  expect(await view(guest)).toMatchObject({ seat: 1, shot: 0, turn: 0, phase: 'break' });
  expect((await view(guest)).hash).toBe((await view(host)).hash);
  // The development hook is gone during an online game.
  for (const { page } of [host, guest]) {
    expect(await page.evaluate(() => 'xxpoolDebug'.replace('xx', '__') in window)).toBe(false);
  }

  // Ana breaks at full power, from the keyboard.
  await unfocus(host.page);
  for (let i = 0; i < 20; i++) await host.page.keyboard.press('Shift+ArrowUp');
  await expect(host.page.getByTestId('power')).toContainText('100%');
  // Ben sees Ana's cue as she sets it up: her power reaches his screen through the previews.
  await expect(guest.page.getByTestId('power')).toContainText('100%', { timeout: 10_000 });
  await host.page.keyboard.press('Space');
  await agree(host, guest, 1);

  // Whatever the break left: a choice for whoever must make it, then the next shot.
  let after = await view(host);
  if (after.phase === 'decision') {
    const decider = after.turn === 0 ? host : guest;
    const choice = decider.page.locator('.choice-list .btn').first();
    await expect(choice).toBeVisible({ timeout: 60_000 });
    await choice.click();
    await expect
      .poll(async () => (await view(host)).phase, { timeout: 20_000 })
      .not.toBe('decision');
    await expect.poll(async () => (await view(guest)).hash).toBe((await view(host)).hash);
    after = await view(host);
  }
  const shooter = after.turn === 0 ? host : guest;
  const watcher = shooter === host ? guest : host;
  // The shooter's controls come alive once the break has played out on their screen; the
  // watcher's stay off, and the keyboard does nothing there.
  await expect(shooter.page.getByTestId('power')).not.toHaveClass(/disabled/, { timeout: 60_000 });
  await expect(watcher.page.getByTestId('power')).toHaveClass(/disabled/);
  await watcher.page.keyboard.press('Space');
  await unfocus(shooter.page);
  for (let i = 0; i < 4; i++) await shooter.page.keyboard.press('Shift+ArrowLeft');
  // Each shot starts from no power: some first, then Space.
  for (let i = 0; i < 8; i++) await shooter.page.keyboard.press('Shift+ArrowUp');
  await shooter.page.keyboard.press('Space');
  await agree(host, guest, 2);

  // A resignation reaches the other side.
  await guest.page.keyboard.press('Escape');
  await guest.page.locator('.pause-item[data-choice="resign"]').click();
  await guest.page
    .getByRole('dialog', { name: 'Resign the match?' })
    .getByRole('button', { name: 'Resign' })
    .click();
  await expect(host.page.getByRole('dialog', { name: 'You win the match' })).toBeVisible({
    timeout: 20_000,
  });

  for (const side of [host, guest]) {
    expect(side.errors).toEqual([]);
    for (const line of side.logs) {
      for (const leak of LEAKS) expect(line, line).not.toMatch(leak);
    }
  }
});

test('cameras and microphones are off until turned on, and show on the cards', async ({
  browser,
}) => {
  const { host, guest } = await connect(browser);
  await joinAs(guest, host);
  const card = (side: Side, seat: 0 | 1) => side.page.getByTestId(`player-${seat}`);
  const playing = (video: ReturnType<Page['locator']>) =>
    expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 45_000 })
      .toBeGreaterThan(0);

  // Nothing starts by itself.
  expect(await deviceRequests(host.page)).toBe(0);
  expect(await deviceRequests(guest.page)).toBe(0);
  await expect(card(host, 0).locator('video')).toBeHidden();

  // Ana turns her camera and microphone on: her own card shows her, mirrored.
  await card(host, 0).getByRole('button', { name: 'Turn your camera on' }).click();
  await card(host, 0).getByRole('button', { name: 'Turn your microphone on' }).click();
  const preview = card(host, 0).locator('video.m-avatar-video');
  await playing(preview);
  await expect(preview).toHaveClass(/mirrored/);
  expect(await deviceRequests(host.page)).toBe(2);

  // Ben sees and hears her on her card, and can mute her on his side only.
  await playing(card(guest, 0).locator('video.m-avatar-video'));
  await expect(card(guest, 0)).toHaveClass(/video-on/);
  const mute = card(guest, 0).getByRole('button', { name: 'Mute Ana' });
  await expect(mute).toBeVisible({ timeout: 30_000 });
  await mute.click();
  await expect(card(guest, 0).getByRole('button', { name: 'Unmute Ana' })).toBeVisible();
  expect(
    await guest.page.evaluate(
      () => document.querySelector<HTMLAudioElement>('body > audio')?.muted,
    ),
  ).toBe(true);

  // Ana turns her camera off: Ben's card follows the real tracks.
  await card(host, 0).getByRole('button', { name: 'Turn your camera off' }).click();
  await expect(preview).toBeHidden();
  await expect(card(guest, 0).locator('video')).toBeHidden({ timeout: 30_000 });

  // Ben never turned anything on, so nothing of his was ever asked for.
  expect(await deviceRequests(guest.page)).toBe(0);
  for (const side of [host, guest]) expect(side.errors).toEqual([]);
});

test('players whose clocks are wrong still find each other', async ({ browser }) => {
  // The relays compare the times signals carry. One clock set three hours behind by hand, the
  // other five minutes fast: both must still meet, on the server's clock.
  const host = await player(browser, './', -3 * 3600_000);
  const link = await createLink(host.page);
  const guest = await player(browser, link, 5 * 60_000);
  await joinAs(guest, host);
  expect((await view(guest)).hash).toBe((await view(host)).hash);
  for (const side of [host, guest]) expect(side.errors).toEqual([]);
});

test('the host’s terms hold on both sides: no aiming guide, and a shot clock that passes the break', async ({
  browser,
}) => {
  const host = await player(browser);
  const link = await createLink(host.page, '30 s', 'Off');
  const guest = await player(browser, link);
  await joinAs(guest, host);
  // Neither player can bring the guide back from the View menu, whatever their own setting.
  for (const { page } of [host, guest]) {
    await page
      .getByRole('menubar', { name: 'Main menu' })
      .getByRole('menuitem', { name: 'View', exact: true })
      .click();
    await expect(page.locator('.menu .menu-entry', { hasText: 'Aiming guide' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(page.locator('.menu')).toHaveCount(0);
  }
  // Ana's clock runs on both cards while she does nothing; her own game calls time after 30 s.
  for (const side of [host, guest]) {
    await expect(side.page.getByTestId('player-0')).toHaveClass(/active/);
  }
  for (const side of [host, guest]) {
    await expect(side.chip).toHaveAttribute('data-turn', '1', { timeout: 60_000 });
  }
  expect(await view(host)).toMatchObject({ phase: 'break', shot: 0 });
  expect((await view(guest)).hash).toBe((await view(host)).hash);
  await expect(guest.page.locator('.toast', { hasText: 'Time ran out for Ana' })).toBeVisible();
  // Nobody lost the match over it: both are still playing.
  for (const side of [host, guest]) {
    await expect(side.chip).toHaveAttribute('data-status', 'playing');
    expect(side.errors).toEqual([]);
  }
});
