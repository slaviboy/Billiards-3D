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

// A modified client attacks an honest player. The test speaks for the attacker with raw data;
// whatever it sends, the honest table changes only as the rules allow, and a rule break loses the
// match and the connection.

import { describe, expect, it } from 'vitest';
import {
  setupFor,
  shotMessage,
  syncMessage,
  type PoolTerms,
} from '../../../src/game/gameMessages.ts';
import { MatchController } from '../../../src/game/MatchController.ts';
import { encodePlacement, encodeShot } from '../../../src/game/shotCodec.ts';
import {
  MAX_DESYNCS,
  OUT_OF_STEP_MESSAGE,
  STEP_TIMEOUT_MS,
} from '../../../src/net/OnlineSession.ts';
import { DEFAULT_LIMITS } from '../../../src/net/PeerGuard.ts';
import { setupMessage } from '../../../src/net/protocol.ts';
import { Motion } from '../../../src/physics/index.ts';
import type { RackState } from '../../../src/rules/types.ts';
import { MemoryLink, plug, settle, unplug } from '../../support/memoryLink.ts';
import {
  BUILD,
  device,
  guestSession,
  hostSession,
  terms,
  type Device,
} from '../../support/onlineSides.ts';

/** A made-up seat token in the right format, for an attacker hosting. */
const SEAT_ID = 'Mallory-seat-123456789';
const FAKE_HASH = '0123456789abcdef';
const hello = (name: string, token?: string) => ({
  t: 'hello',
  v: 1,
  build: BUILD,
  name,
  ...(token ? { token } : {}),
});

/** An honest host (seat 0) against an attacker who has just sat down in seat 1. */
async function honestHost(over: Partial<PoolTerms> = {}) {
  const me = device();
  const link = new MemoryLink();
  const evil = new MemoryLink();
  const session = hostSession(me, link, over);
  plug(link, evil);
  await settle();
  evil.sendRaw(hello('Eve'));
  await settle();
  return { me, link, evil, session };
}

/** An honest guest (seat 1) against an attacker hosting in seat 0, to break first. */
async function honestGuest() {
  const me = device();
  const link = new MemoryLink();
  const evil = new MemoryLink();
  const session = guestSession(me, link);
  plug(evil, link);
  await settle();
  evil.sendRaw(hello('Mallory'));
  evil.sendRaw(setupMessage(SEAT_ID, terms('Ben', { names: ['Mallory', 'Ben'] })));
  await settle();
  return { me, link, evil, session };
}

/**
 * The attacker's break from where the cue ball lies, with the fingerprint an honest simulation
 * gives (so that only the changes in `over` can be wrong).
 */
function evilBreak(me: Device, over: object = {}) {
  const match = me.match;
  const cue = match.current.balls[0]!;
  const to = match.table.footSpot;
  const code = encodeShot(Math.atan2(to.y - cue.ry, to.x - cue.rx), 0, 7, 0, -0.1);
  const placement = encodePlacement(cue.rx, cue.ry);
  let h = FAKE_HASH;
  try {
    const copy = new MatchController(match.current.setup);
    copy.state.set(match.current);
    copy.shoot(code, { pocket: null, safety: false }, placement);
    h = copy.hash();
  } catch {
    // Not a shot the match would take now; the receiver will say why.
  }
  return { ...shotMessage(match.current.shot, code, null, false, placement, h), ...over };
}

/** Sets up the honest table for a test: the rack's fields, and the balls still on the table. */
function arrange(me: Device, rack: Partial<RackState>, onTable?: number[]) {
  const s = me.match.current;
  const pocket = me.match.table.pockets[0]!.center;
  const balls = s.balls.map((b, n) =>
    !onTable || n === 0 || onTable.includes(n)
      ? b
      : { ...b, rx: pocket.x, ry: pocket.y, s: Motion.Pocketed },
  );
  me.match.state.set({ ...s, balls, rack: { ...s.rack, ...rack } });
}

function expectForfeit(s: Awaited<ReturnType<typeof honestHost>>, detail?: RegExp) {
  expect(s.me.match.current.winner).toBe(0);
  expect(s.link.kicked).toBe(true);
  expect(s.session.state.get().status).toBe('closed');
  expect(s.session.state.get().message).toMatch(detail ?? /^Game ended: Eve's app /);
}

const balls = (me: Device) => me.match.current.balls.map((b) => [b.rx, b.ry, b.s]);

describe('an attacker against an honest player', () => {
  it('a shot with the wrong index loses the match, and the table stays as it was', async () => {
    const s = await honestHost({ firstBreak: 1 });
    const before = balls(s.me);
    s.evil.sendRaw(evilBreak(s.me, { n: 5 }));
    await settle();
    expectForfeit(s, /played a shot out of order/);
    expect(balls(s.me)).toEqual(before);
    expect(s.me.match.current.shot).toBe(0);
  });

  it('a shot out of turn forfeits', async () => {
    const s = await honestHost();
    s.evil.sendRaw(evilBreak(s.me));
    await settle();
    expectForfeit(s, /played out of turn/);
  });

  it('the same shot sent twice forfeits after the first has played', async () => {
    const s = await honestHost({ firstBreak: 1 });
    const shot = evilBreak(s.me);
    s.evil.sendRaw(shot);
    s.evil.sendRaw(shot);
    await settle();
    expectForfeit(s);
    expect(s.me.match.current.shot).toBe(1);
  });

  it('a shot outside what the cue can do forfeits; a malformed one is dropped and counted', async () => {
    let s = await honestHost({ firstBreak: 1 });
    s.evil.sendRaw(evilBreak(s.me, { yaw: 0.5 }));
    s.evil.sendRaw(evilBreak(s.me, { speed: '7000' }));
    await settle();
    expect(s.session.state.get().status).toBe('playing');
    for (const over of [{ speed: 99_999 }, { pitch: -1 }, { a: 400, b: 400 }, { pocket: 7 }]) {
      s = await honestHost({ firstBreak: 1 });
      s.evil.sendRaw(evilBreak(s.me, over));
      await settle();
      expectForfeit(s, /outside what the cue can do/);
      expect(s.me.match.current.shot).toBe(0);
    }
  });

  it('a cue ball placed on a ball, or beyond the head string for the break, forfeits', async () => {
    let s = await honestHost({ firstBreak: 1 });
    const spot = s.me.match.table.footSpot;
    s.evil.sendRaw(evilBreak(s.me, encodePlacement(spot.x, spot.y)));
    await settle();
    expectForfeit(s, /placed the cue ball where it may not go/);

    s = await honestHost({ firstBreak: 1 });
    const line = s.me.match.table.headString;
    s.evil.sendRaw(evilBreak(s.me, encodePlacement(0.6, line + 0.1)));
    await settle();
    expectForfeit(s, /placed the cue ball where it may not go/);

    s = await honestHost({ firstBreak: 1 });
    s.evil.sendRaw(evilBreak(s.me, encodePlacement(-1, 0.5)));
    await settle();
    expectForfeit(s, /placed the cue ball where it may not go/);
  });

  it('the cue ball must be placed exactly when it is in hand', async () => {
    let s = await honestHost({ firstBreak: 1 });
    const { x: _x, y: _y, ...unplaced } = evilBreak(s.me);
    s.evil.sendRaw(unplaced);
    await settle();
    expectForfeit(s, /without placing it/);

    s = await honestHost({ firstBreak: 1 });
    arrange(s.me, { phase: 'play', turn: 1, inHand: 'none' });
    s.evil.sendRaw(evilBreak(s.me));
    await settle();
    expectForfeit(s, /moved the cue ball when it was not in hand/);
  });

  it('a pocket must be called for the 8, and only for the 8', async () => {
    let s = await honestHost({ firstBreak: 1 });
    // Stripes are the attacker's and all gone: the 8 is next, and needs a call.
    arrange(s.me, { phase: 'play', turn: 1, inHand: 'none', groups: [1, 2] }, [1, 2, 8]);
    const { x: _x, y: _y, ...shot } = evilBreak(s.me);
    s.evil.sendRaw(shot);
    await settle();
    expectForfeit(s, /without calling a pocket/);

    s = await honestHost({ firstBreak: 1 });
    arrange(s.me, { phase: 'play', turn: 1, inHand: 'none', groups: [1, 2] });
    const { x: _x2, y: _y2, ...called } = evilBreak(s.me, { pocket: 3 });
    s.evil.sendRaw(called);
    await settle();
    expectForfeit(s, /called a pocket when none was due/);
  });

  it('a choice that is not the attacker’s, not on offer or not due forfeits', async () => {
    let s = await honestHost();
    s.evil.sendRaw({ t: 'decide', n: 0, choice: 'accept' });
    await settle();
    expectForfeit(s, /when none was due/);

    s = await honestHost();
    arrange(s.me, { phase: 'decision', decision: 'illegalBreak', turn: 0 });
    s.evil.sendRaw({ t: 'decide', n: 0, choice: 'accept' });
    await settle();
    expectForfeit(s, /not theirs/);

    s = await honestHost();
    arrange(s.me, { phase: 'decision', decision: 'eightOnBreak', turn: 1 });
    s.evil.sendRaw({ t: 'decide', n: 0, choice: 'rerackOther' });
    await settle();
    expectForfeit(s, /not on offer/);
  });

  it('a time-out out of turn forfeits; one in turn only costs the attacker', async () => {
    let s = await honestHost();
    s.evil.sendRaw({ t: 'timeout', n: 0 });
    await settle();
    expectForfeit(s, /out of turn/);

    s = await honestHost({ firstBreak: 1 });
    s.evil.sendRaw({ t: 'timeout', n: 0 });
    await settle();
    expect(s.session.state.get().status).toBe('playing');
    expect(s.me.match.current.rack).toMatchObject({ phase: 'break', turn: 0 });
  });

  it('cue previews out of turn change nothing; a preview the cue could not make forfeits', async () => {
    let s = await honestHost();
    const cue = { ...s.me.match.current.balls[0]! };
    s.evil.sendRaw({ t: 'aim', yaw: 1000, pitch: 0, speed: 1000, a: 0, b: 0, pull: 300 });
    s.evil.sendRaw({ t: 'place', x: 60000, y: 40000 });
    await settle();
    expect(s.session.state.get().status).toBe('playing');
    expect(s.me.table.remoteAim).toBeNull();
    expect(s.me.match.current.balls[0]).toEqual(cue);

    s = await honestHost({ firstBreak: 1 });
    s.evil.sendRaw({ t: 'aim', yaw: 1000, pitch: 0, speed: 1000, a: 0, b: 0, pull: 300 });
    await settle();
    expect(s.me.table.remoteAim).toEqual({
      code: { yaw: 1000, pitch: 0, speed: 1000, a: 0, b: 0 },
      pull: 0.3,
    });
    s.evil.sendRaw({ t: 'aim', yaw: 1000, pitch: 0, speed: 1_000_000, a: 0, b: 0, pull: 0 });
    await settle();
    expectForfeit(s, /outside what the cue can do/);
  });

  it('a flood of bad data is dropped, then the attacker is disconnected and loses', async () => {
    const s = await honestHost();
    s.evil.sendRaw({ ...hello('x'), name: 'x'.repeat(10_000) });
    await settle();
    expect(s.session.state.get().status).toBe('playing');
    for (let i = 1; i < DEFAULT_LIMITS.maxDrops; i++) s.evil.sendRaw({ t: 'nonsense', i });
    await settle();
    expectForfeit(s, /kept sending invalid data/);
    expect(s.me.match.current.shot).toBe(0);
  });

  it('a flood of well-formed previews beyond the rate is cut off the same way', async () => {
    const s = await honestHost({ firstBreak: 1 });
    for (let i = 0; i < DEFAULT_LIMITS.burst + DEFAULT_LIMITS.maxDrops; i++) {
      s.evil.sendRaw({ t: 'aim', yaw: i, pitch: 0, speed: 1000, a: 0, b: 0, pull: 0 });
    }
    await settle();
    expectForfeit(s, /kept sending invalid data/);
  });

  it('a guest cannot send a table or new terms to the host', async () => {
    const s = await honestHost();
    const other = new MatchController(setupFor(terms('Eve')));
    other.shoot(
      encodeShot(1.5, 0, 7, 0, 0),
      { pocket: null, safety: false },
      encodePlacement(0.6, 0.4),
    );
    s.evil.sendRaw(syncMessage(other.current, other.hash()));
    s.evil.sendRaw(setupMessage(SEAT_ID, terms('Eve', { race: 7 })));
    await settle();
    expect(s.me.match.current.shot).toBe(0);
    expect(s.me.match.current.setup.race).toBe(3);
    expect(s.session.state.get().status).toBe('playing');
  });

  it('a host cannot rewrite the guest’s table with a table nobody asked for', async () => {
    const s = await honestGuest();
    const other = new MatchController(s.me.match.current.setup);
    other.shoot(
      encodeShot(1.5, 0, 7, 0, 0),
      { pocket: null, safety: false },
      encodePlacement(0.6, 0.4),
    );
    s.evil.sendRaw(syncMessage(other.current, other.hash()));
    await settle();
    expect(s.me.match.current.shot).toBe(0);
    expect(s.me.match.hash()).not.toBe(other.hash());
  });

  it('a host cannot change the terms once the match is set up', async () => {
    const s = await honestGuest();
    s.evil.sendRaw(setupMessage(SEAT_ID, terms('Ben', { race: 7, firstBreak: 1 })));
    await settle();
    expect(s.me.table.matches).toHaveLength(1);
    expect(s.me.match.current.setup).toMatchObject({ race: 3, firstBreak: 0 });
  });

  it('on a rejoin, a table that cannot be this match, or does not match its fingerprint, loses', async () => {
    for (const forge of ['score', 'fingerprint'] as const) {
      const s = await honestGuest();
      unplug(s.evil, s.link);
      await settle();
      const evil = new MemoryLink();
      plug(evil, s.link);
      await settle();
      evil.sendRaw(hello('Mallory', SEAT_ID));
      evil.sendRaw(setupMessage(SEAT_ID, terms('Ben', { names: ['Mallory', 'Ben'] })));
      const real = syncMessage(s.me.match.current, s.me.match.hash());
      const moved = real.balls.map((b, n) => (n === 5 ? ([b[0] + 0.01, b[1], b[2]] as const) : b));
      evil.sendRaw(
        forge === 'score' ? { ...real, h: FAKE_HASH, score: [5, 0] } : { ...real, balls: moved },
      );
      await settle();
      expect(s.me.match.current.winner, forge).toBe(1);
      expect(s.session.state.get().message).toMatch(/sent a table that cannot be this match/);
    }
  });

  it('a wrong fingerprint is no rule break: the honest host’s table is kept', async () => {
    const s = await honestHost({ firstBreak: 1 });
    s.evil.sendRaw(evilBreak(s.me, { h: FAKE_HASH }));
    await settle();
    expect(s.session.state.get()).toMatchObject({ status: 'playing', desyncs: 1, resyncing: true });
    expect(s.me.table.localSeats).toEqual([]);
    const played = s.me.match.hash();
    // The attacker says it has stopped: it gets the host's table, which stays as it is.
    s.evil.sendRaw({ t: 'desync', n: 0 });
    await settle();
    expect(s.evil.sentOf('desync')).toHaveLength(1);
    expect(s.link.sentOf('sync').at(-1)).toMatchObject({ h: played });
    expect(s.session.state.get().resyncing).toBe(false);
    expect(s.me.match.hash()).toBe(played);
  });

  it('a peer that never answers while the tables are brought in step loses', async () => {
    const s = await honestHost({ firstBreak: 1 });
    s.evil.sendRaw(evilBreak(s.me, { h: FAKE_HASH }));
    await settle();
    expect(s.session.state.get().resyncing).toBe(true);
    s.me.timers.advance(STEP_TIMEOUT_MS);
    await settle();
    expectForfeit(s, /did not help bring the two tables back in step/);
  });

  it('a host that keeps claiming the tables differ ends the session, and nobody loses', async () => {
    const s = await honestGuest();
    let taken = 0;
    for (let i = 0; i <= MAX_DESYNCS; i++) {
      s.evil.sendRaw({ t: 'desync', n: 0 });
      await settle();
      if (s.session.state.get().desyncs > MAX_DESYNCS) break;
      s.evil.sendRaw(syncMessage(s.me.match.current, s.me.match.hash()));
      await settle();
      taken++;
    }
    s.me.timers.advance(1_000);
    await settle();
    expect(taken).toBe(MAX_DESYNCS);
    expect(s.session.state.get()).toMatchObject({ status: 'closed', message: OUT_OF_STEP_MESSAGE });
    expect(s.me.match.current.winner).toBeNull();
  });

  it('a name is only ever text, without control or direction characters', async () => {
    const s = await honestHost();
    expect(s.session.state.get().friendName).toBe('Eve');
    const me = device();
    const link = new MemoryLink();
    const evil = new MemoryLink();
    const session = hostSession(me, link);
    plug(link, evil);
    await settle();
    evil.sendRaw(hello('<b onclick=x>Eve</b>‮\u0000'));
    await settle();
    expect(session.state.get().friendName).toBe('<b onclick=x>Eve</b>');
    expect(me.match.current.setup.names[1]).toBe('<b onclick=x>Eve</b>');
  });

  it('nothing counts before the attacker says hello', async () => {
    const me = device();
    const link = new MemoryLink();
    const evil = new MemoryLink();
    hostSession(me, link, { firstBreak: 1 });
    plug(link, evil);
    await settle();
    evil.sendRaw({ t: 'resign' });
    evil.sendRaw(evilBreak(me));
    await settle();
    expect(me.table.matches).toEqual([]);
  });
});
