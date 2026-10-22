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

// 8-ball's port to an online session, on its own: what it sends for the local player's play, how
// it plays and checks the other player's, the previews both ways, tables taken and given, and the
// watch on the other player's shot clock.

import { describe, expect, it } from 'vitest';
import { PLAYBACK_TAIL_MS, PREVIEW_MS, STALL_GRACE_MS } from '../../../src/game/GamePort.ts';
import {
  shotMessage,
  syncMessage,
  type GameMessage,
  type PoolTerms,
} from '../../../src/game/gameMessages.ts';
import { MatchController } from '../../../src/game/MatchController.ts';
import { encodePlacement, encodeShot } from '../../../src/game/shotCodec.ts';
import type { Role } from '../../../src/net/OnlineSession.ts';
import { device, shotFor, terms, type Device } from '../../support/onlineSides.ts';

async function started(role: Role = 'host', over: Partial<PoolTerms> = {}) {
  const d = device();
  const sent: Array<{ message: GameMessage; changesMatch: boolean }> = [];
  const violations: string[] = [];
  d.port.onLocal({
    send: (message, changesMatch) => sent.push({ message, changesMatch }),
    violation: (_reason, detail) => violations.push(detail),
  });
  await d.port.start(terms('Ben', over), role);
  return { d, sent, violations, last: () => sent.at(-1)?.message };
}

/** The other player's shot on this device's table, with the fingerprint an honest copy gives. */
function theirShot(d: Device, heading?: number) {
  const match = d.match;
  const copy = new MatchController(match.current.setup);
  copy.state.set(match.current);
  const code = shotFor(copy, heading);
  const cue = match.current.balls[0]!;
  const placement = match.inHand() ? encodePlacement(cue.rx, cue.ry) : null;
  const pocket = match.needsCall() ? 0 : null;
  copy.shoot(code, { pocket, safety: false }, placement);
  return shotMessage(match.current.shot, code, pocket, false, placement, copy.hash());
}

describe('the 8-ball port', () => {
  it('starts the host’s match with this device in its seat', async () => {
    let s = await started('host');
    expect(s.d.port.seat).toBe(0);
    expect(s.d.table.localSeats).toEqual([0]);
    expect(s.d.port.status()).toBe('playing');
    expect(s.d.match.current.setup).toMatchObject({ mode: 'online', names: ['Ana', 'Ben'] });
    s = await started('guest');
    expect(s.d.port.seat).toBe(1);
    s = await started('guest', { host: 1 });
    expect(s.d.port.seat).toBe(0);
    expect(s.d.port.snapshot()).toEqual(syncMessage(s.d.match.current, s.d.match.hash()));
  });

  it('sends the local player’s shot as played: index, cue, placement, call and fingerprint', async () => {
    const { d, sent, last } = await started();
    const cue = d.match.current.balls[0]!;
    const placement = encodePlacement(cue.rx, cue.ry);
    const code = shotFor(d.match);
    d.shoot(code);
    expect(last()).toEqual(shotMessage(0, code, null, false, placement, d.match.hash()));
    expect(sent.at(-1)!.changesMatch).toBe(true);
  });

  it('sends the local player’s decisions and time-outs, and nothing of the other player’s', async () => {
    const { d, sent, last } = await started('host', { shotClock: 30 });
    d.match.timeOut();
    expect(last()).toEqual({ t: 'timeout', n: 0 });
    // The time-out passed the break to the other player: their time-out is not this side's.
    d.match.timeOut();
    expect(sent).toHaveLength(1);
  });

  it('previews the cue at most once a tick, the cue ball in hand first, and only changes', async () => {
    const { d, sent } = await started();
    d.timers.advance(PREVIEW_MS);
    expect(sent.map((s) => [s.message.t, s.changesMatch])).toEqual([['place', false]]);
    d.timers.advance(PREVIEW_MS);
    expect(sent.at(-1)!.message.t).toBe('aim');
    d.timers.advance(PREVIEW_MS * 4);
    expect(sent).toHaveLength(2);
    d.table.aim = { code: encodeShot(1, 3, 2, 0.1, 0.1), pull: 0.5 };
    d.timers.advance(PREVIEW_MS);
    expect(sent.at(-1)!.message).toMatchObject({ t: 'aim', pull: 500 });
    d.match.placeCueBall(0.5, 0.3);
    d.timers.advance(PREVIEW_MS);
    expect(sent.at(-1)!.message).toEqual({ t: 'place', x: 50000, y: 30000 });
    // Not while play is held, nor on the other player's turn.
    d.port.hold(true);
    d.table.aim = { code: encodeShot(2, 3, 2, 0, 0), pull: 0 };
    d.timers.advance(PREVIEW_MS * 2);
    expect(sent).toHaveLength(4);
    d.port.hold(false);
    d.match.timeOut();
    d.timers.advance(PREVIEW_MS * 2);
    expect(sent.filter((s) => s.message.t === 'aim')).toHaveLength(2);
  });

  it('shows the other player’s previews on their turn, and only then', async () => {
    const { d } = await started('host', { firstBreak: 1 });
    const aim = { t: 'aim', yaw: 5, pitch: 10, speed: 900, a: 1, b: 2, pull: 250 } as const;
    expect(await d.port.receive(aim)).toEqual({ kind: 'shown' });
    expect(d.table.remoteAim).toEqual({
      code: { yaw: 5, pitch: 10, speed: 900, a: 1, b: 2 },
      pull: 0.25,
    });
    await d.port.receive({ t: 'place', x: 50000, y: 30000 });
    expect(d.match.current.balls[0]).toMatchObject({ rx: 50000 * 1e-5, ry: 30000 * 1e-5 });
    // Somewhere the cue ball may not go: not moved.
    await d.port.receive({ t: 'place', x: 50000, y: 200000 });
    expect(d.match.current.balls[0]).toMatchObject({ rx: 50000 * 1e-5, ry: 30000 * 1e-5 });
    // Once it is this player's turn, previews show nothing.
    d.match.timeOut();
    d.table.remoteAim = null;
    await d.port.receive(aim);
    expect(d.table.remoteAim).toBeNull();
  });

  it('plays the other player’s shot and compares the table it led to', async () => {
    const { d } = await started('host', { firstBreak: 1 });
    const shot = theirShot(d);
    expect(await d.port.receive(shot)).toEqual({ kind: 'played' });
    expect(d.match.hash()).toBe(shot.h);
    // Once it has played out, the interface follows it up as after any shot.
    await new Promise((resolve) => setImmediate(resolve));
    expect(d.table.afterShots).toHaveLength(1);

    const other = await started('host', { firstBreak: 1 });
    const wrong = { ...theirShot(other.d), h: '0123456789abcdef' };
    expect(await other.d.port.receive(wrong)).toEqual({ kind: 'desync', n: 0 });
    expect(other.d.match.current.shot).toBe(1);
  });

  it('goes on to the next rack when the other player has broken it', async () => {
    const { d } = await started();
    d.match.concede(0);
    expect(d.match.current.rack.phase).toBe('over');
    // The next break is the other player's, and they did not wait for this side.
    expect(await d.port.receive(theirShotAfterNextRack(d))).toEqual({ kind: 'played' });
    expect(d.match.current.rackNumber).toBe(2);
  });

  it('takes the host’s table when it is one of this match, and says when it is its own', async () => {
    const { d } = await started('guest');
    const own = syncMessage(d.match.current, d.match.hash());
    expect(await d.port.restore(own, 'rejoin')).toBe('same');
    const host = new MatchController(d.match.current.setup);
    host.shoot(shotFor(host), { pocket: null, safety: false }, encodePlacement(0.6, 0.4));
    const theirs = syncMessage(host.current, host.hash());
    expect(await d.port.restore(theirs, 'resync')).toBe('restored');
    expect(d.match.hash()).toBe(host.hash());
    // One whose fingerprint does not name it, or that is not this match's, is refused.
    const moved = theirs.balls.map((b, n) => (n === 3 ? ([b[0] + 0.001, b[1], b[2]] as const) : b));
    expect(await d.port.restore({ ...theirs, balls: moved }, 'resync')).toBe('rejected');
    expect(await d.port.restore({ ...theirs, score: [9, 0] }, 'resync')).toBe('rejected');
  });

  it('refuses a table more than one action behind this one', async () => {
    const { d } = await started('host', { firstBreak: 0 });
    const start = syncMessage(d.match.current, d.match.hash());
    d.shoot();
    d.match.state.set({ ...d.match.current, shot: 2 });
    expect(await d.port.restore(start, 'rejoin')).toBe('rejected');
  });

  it('sends its last action again when the host’s table is from just before it', async () => {
    const { d, sent } = await started('guest', { firstBreak: 1 });
    const before = syncMessage(d.match.current, d.match.hash());
    d.shoot();
    const shot = sent.at(-1)!.message;
    expect(await d.port.restore(before, 'rejoin')).toBe('resent');
    expect(sent.at(-1)!.message).toEqual(shot);
    expect(d.match.current.shot).toBe(1);
  });

  it('holds play while the other player is away, and gives it back', async () => {
    const { d } = await started();
    d.port.hold(true);
    expect(d.table.localSeats).toEqual([]);
    d.port.hold(false);
    expect(d.table.localSeats).toEqual([0]);
  });

  it('times the other player’s turn: limit, network allowance and a grace', async () => {
    const { d, violations } = await started('host', { shotClock: 30, firstBreak: 1 });
    d.port.setLagAllowance(200);
    expect(d.port.remoteClock()).toEqual({ used: 0, limit: 30.2 });
    d.timers.advance(10_000);
    expect(d.port.remoteClock()).toEqual({ used: 10, limit: 30.2 });
    d.timers.advance(20_000 + 200 + STALL_GRACE_MS - 1);
    expect(violations).toEqual([]);
    d.timers.advance(1);
    expect(violations).toEqual(['let its shot clock run out without saying so']);
  });

  it('starts a clock once the shots so far have played out, one after another', async () => {
    const { d, violations } = await started('host', { shotClock: 30 });
    // The break, then shots until one passes the table (the seed is fixed: always the same way),
    // all at once: on a screen they would play one after the other at normal speed.
    let playback = 0;
    const play = (code?: ReturnType<typeof shotFor>) => {
      playback += d.shoot(code).timeline.duration * 1000 + PLAYBACK_TAIL_MS;
    };
    play();
    for (let i = 0; i < 10 && d.match.current.rack.turn === 0; i++) play(shotFor(d.match, 0.3 + i));
    expect(d.match.current.rack).toMatchObject({ phase: 'play', turn: 1 });
    expect(d.port.remoteClock()!.used).toBe(0);
    d.timers.advance(playback);
    expect(d.port.remoteClock()!.used).toBe(0);
    d.timers.advance(30_000 + STALL_GRACE_MS - 1);
    expect(violations).toEqual([]);
    d.timers.advance(1);
    expect(violations).toHaveLength(1);
  });

  it('calls time on this player when their own clock runs out, and tells the other side', async () => {
    const { d, last } = await started('host', { shotClock: 30 });
    expect(d.port.clockFor(0)).toEqual({ used: 0, limit: 30 });
    expect(d.port.clockFor(1)).toBeNull();
    d.timers.advance(29_999);
    expect(d.match.current.rack.breaker).toBe(0);
    d.timers.advance(1);
    expect(last()).toEqual({ t: 'timeout', n: 0 });
    expect(d.match.current.rack).toMatchObject({ phase: 'break', breaker: 1, turn: 1 });
    expect(d.table.notes).toContain('Time ran out for Ana. Ben breaks');
    // Now the other player's clock runs, with its allowance.
    expect(d.port.clockFor(1)).toEqual({ used: 0, limit: 30 });
  });

  it('keeps this player’s clock running whatever the screen does, and not while held', async () => {
    const { d, last } = await started('host', { shotClock: 30 });
    // The screen is still busy playing something out: the clock runs all the same.
    d.table.playing = true;
    d.timers.advance(15_000);
    d.port.hold(true);
    d.timers.advance(60_000);
    expect(last()?.t).not.toBe('timeout');
    d.port.hold(false);
    d.timers.advance(30_000);
    expect(last()).toEqual({ t: 'timeout', n: 0 });
  });

  it('does not run their clock while play is held', async () => {
    const { d, violations } = await started('host', { shotClock: 30, firstBreak: 1 });
    d.port.hold(true);
    expect(d.port.remoteClock()).toBeNull();
    d.timers.advance(120_000);
    expect(violations).toEqual([]);
    d.port.hold(false);
    expect(d.port.remoteClock()!.used).toBe(0);
  });

  it('ends the match for one side: resigning, or the other side forfeiting', async () => {
    let s = await started();
    await s.d.port.resign();
    expect(s.d.match.current.winner).toBe(1);
    expect(s.d.port.status()).toBe('over');
    s = await started();
    await s.d.port.forfeit('invalid-shot');
    expect(s.d.match.current.winner).toBe(0);
  });
});

/** The other player's break of the next rack, made on a copy that has gone on to it. */
function theirShotAfterNextRack(d: Device): GameMessage {
  const copy = new MatchController(d.match.current.setup);
  copy.state.set(d.match.current);
  copy.nextRack();
  const code = shotFor(copy);
  const cue = copy.current.balls[0]!;
  const placement = encodePlacement(cue.rx, cue.ry);
  copy.shoot(code, { pocket: null, safety: false }, placement);
  return shotMessage(d.match.current.shot, code, null, false, placement, copy.hash());
}
