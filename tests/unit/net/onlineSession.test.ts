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

// Two honest players' devices, the real match on each, connected in memory: the match is set up,
// shots, decisions and time-outs cross and both tables stay the same to the last bit; connections
// drop and come back, players reload, leave, and the two tables are brought back in step when
// they differ.

import { describe, expect, it } from 'vitest';
import { NEXT_RACK_MS, STALL_GRACE_MS } from '../../../src/game/GamePort.ts';
import type { PoolTerms } from '../../../src/game/gameMessages.ts';
import { encodeShot } from '../../../src/game/shotCodec.ts';
import {
  CLAIM_AFTER_MS,
  CONNECT_TIMEOUT_MS,
  HOST_RETRY_MESSAGE,
  MAX_DESYNCS,
  MAX_LAG_ALLOWANCE_MS,
  OUT_OF_STEP_MESSAGE,
  OnlineSession,
  PING_EVERY_MS,
  RELOAD_MESSAGE,
  type SessionEvent,
} from '../../../src/net/OnlineSession.ts';
import { CHOICES } from '../../../src/rules/types.ts';
import { MemoryLink, plug, settle, unplug } from '../../support/memoryLink.ts';
import {
  device,
  guestSession,
  hostSession,
  sessionOptions,
  shotFor,
  type Device,
} from '../../support/onlineSides.ts';

/** A host (seat 0) and a guest (seat 1), connected and set up. */
async function game(over: Partial<PoolTerms> = {}) {
  const a = device();
  const b = device();
  const links = { host: new MemoryLink(), guest: new MemoryLink() };
  const host = hostSession(a, links.host, over);
  const guest = guestSession(b, links.guest);
  const events: Record<'host' | 'guest', SessionEvent['kind'][]> = { host: [], guest: [] };
  host.onEvent((e) => events.host.push(e.kind));
  guest.onEvent((e) => events.guest.push(e.kind));
  plug(links.host, links.guest);
  await settle();
  return { a, b, host, guest, links, events };
}

/** Leaves, letting the goodbye's short wait pass. */
async function leave(session: { leave(): Promise<void> }, d: Device) {
  const leaving = session.leave();
  await settle();
  d.timers.advance(1_000);
  await leaving;
  await settle();
}

/** Plays on, whoever is at the table, deciding with the first choice; checks both stay alike. */
async function playOn(a: Device, b: Device, shots: number) {
  for (let i = 0; i < shots; i++) {
    const s = a.match.current;
    if (s.winner !== null || s.rack.phase === 'over') return;
    const side = s.rack.turn === 0 ? a : b;
    if (s.rack.phase === 'decision') {
      side.match.decide(CHOICES[s.rack.decision!][0]!);
    } else {
      side.shoot(shotFor(side.match, 1 + i * 0.7));
    }
    await settle();
    expect(b.match.hash(), `after action ${i}`).toBe(a.match.hash());
  }
}

/** Moves ball 15 a hair on this device only, so its next simulation comes out different. */
function nudge(d: Device) {
  const s = d.match.current;
  const balls = s.balls.map((ball, n) => (n === 15 ? { ...ball, rx: ball.rx + 1e-9 } : ball));
  d.match.state.set({ ...s, balls });
}

describe('OnlineSession with 8-ball', () => {
  it('sets up the match: the host’s terms on both sides, a seat each, names crossing', async () => {
    const { a, b, host, guest, events } = await game({ race: 5, shotClock: 30 });
    expect(a.table.matches).toHaveLength(1);
    expect(b.table.matches).toEqual(a.table.matches);
    expect(a.table.matches[0]).toMatchObject({
      mode: 'online',
      race: 5,
      shotClock: 30,
      names: ['Ana', 'Ben'],
      firstBreak: 0,
    });
    expect(a.table.localSeats).toEqual([0]);
    expect(b.table.localSeats).toEqual([1]);
    expect(host.state.get()).toMatchObject({ status: 'playing', friendName: 'Ben' });
    expect(guest.state.get()).toMatchObject({ status: 'playing', friendName: 'Ana' });
    expect(events.host).toEqual(['joined']);
    expect(events.guest).toEqual(['joined']);
    expect(b.match.hash()).toBe(a.match.hash());
    expect(a.table.canAct()).toBe(true);
    expect(b.table.canAct()).toBe(false);
  });

  it('carries shots and decisions both ways, and both tables stay the same to the bit', async () => {
    const { a, b } = await game();
    a.shoot();
    await settle();
    expect(b.match.current.shot).toBe(1);
    expect(b.match.hash()).toBe(a.match.hash());
    // The receiver plays the shot out and follows it up as after any shot.
    expect(b.table.afterShots).toHaveLength(1);
    await playOn(a, b, 8);
    expect(a.match.current.shot).toBeGreaterThan(3);
  });

  it('the decision a break leaves is made by the deciding seat, and crosses', async () => {
    const { a, b } = await game();
    const cue = a.match.current.balls[0]!;
    const to = a.match.table.footSpot;
    // Too soft to be a legal break: the other player decides how play goes on.
    a.shoot(encodeShot(Math.atan2(to.y - cue.ry, to.x - cue.rx), 0, 0.3, 0, 0));
    await settle();
    expect(b.match.current.rack).toMatchObject({ phase: 'decision', turn: 1 });
    b.match.decide('accept');
    await settle();
    expect(a.match.current.rack.phase).toBe('play');
    expect(a.match.hash()).toBe(b.match.hash());
    expect(a.table.notes).toContain('Ben plays the table as it lies');
  });

  it('a shooter’s own time-out crosses: on the break the other player breaks instead', async () => {
    const { a, b } = await game({ shotClock: 30 });
    a.match.timeOut();
    await settle();
    expect(b.match.current.rack).toMatchObject({ phase: 'break', breaker: 1, turn: 1 });
    expect(b.table.notes).toContain('Time ran out for Ana. Ben breaks');
    expect(b.match.hash()).toBe(a.match.hash());
    expect(b.table.canAct()).toBe(true);
  });

  it('watches the other player’s shot clock, and forfeits an app that stops keeping it', async () => {
    const { a, b, host, links } = await game({ shotClock: 30, firstBreak: 1 });
    // The measured delay (the memory link's 40 ms round trip) is allowed for, and a grace.
    expect(a.port.remoteClock()).toEqual({ used: 0, limit: 30.04 });
    a.timers.advance(30_000 + 40 + STALL_GRACE_MS - 1);
    await settle();
    expect(host.state.get().status).toBe('playing');
    a.timers.advance(1);
    await settle();
    expect(a.match.current.winner).toBe(0);
    expect(links.host.kicked).toBe(true);
    expect(host.state.get().message).toBe(
      "Game ended: Ben's app let its shot clock run out without saying so.",
    );
    expect(b.match.current.winner).toBeNull();
  });

  it('an honest app calls its own time, and the other side follows without a word', async () => {
    const { a, b, host } = await game({ shotClock: 30, firstBreak: 1 });
    // Both devices' clocks run; the guest's runs out first, and its app says so in time.
    a.timers.advance(30_000);
    b.timers.advance(30_000);
    await settle();
    a.timers.advance(STALL_GRACE_MS + 1_000);
    await settle();
    expect(host.state.get().status).toBe('playing');
    expect(a.match.current.rack).toMatchObject({ phase: 'break', breaker: 0, turn: 0 });
    expect(a.match.hash()).toBe(b.match.hash());
    expect(a.table.notes).toContain('Time ran out for Ben. Ana breaks');
    expect(b.table.notes).toContain('Time ran out for Ben. Ana breaks');
  });

  it('does not watch the clock while the other player is away, and starts it afresh after', async () => {
    const { a, host, links } = await game({ shotClock: 30, firstBreak: 1 });
    a.timers.advance(20_000);
    unplug(links.host, links.guest);
    await settle();
    a.timers.advance(60_000);
    await settle();
    expect(host.state.get().status).toBe('away');
    plug(links.host, links.guest);
    await settle();
    a.timers.advance(30_000);
    await settle();
    expect(host.state.get().status).toBe('playing');
    expect(a.match.current.winner).toBeNull();
  });

  it('gives back the measured network delay on the other player’s clock, capped', async () => {
    const { a, links } = await game({ shotClock: 30, firstBreak: 1 });
    links.host.rtt = 5_000;
    a.timers.advance(PING_EVERY_MS);
    await settle();
    a.timers.advance(PING_EVERY_MS);
    await settle();
    a.timers.advance(PING_EVERY_MS);
    await settle();
    expect(a.port.remoteClock()!.limit).toBe(30 + MAX_LAG_ALLOWANCE_MS / 1000);
  });

  it('plays a rematch once both ask, on a fresh seed, the other player breaking first', async () => {
    const { a, b, host, guest } = await game();
    await host.resign();
    await settle();
    expect(a.match.current.winner).toBe(1);
    expect(b.match.current.winner).toBe(1);
    await host.requestRematch();
    await settle();
    expect(guest.state.get().rematch).toBe('received');
    await guest.requestRematch();
    await settle();
    expect(a.table.matches).toHaveLength(2);
    expect(b.table.matches).toEqual(a.table.matches);
    const [first, second] = a.table.matches;
    expect(second!.firstBreak).toBe(1);
    expect(second!.seed).not.toBe(first!.seed);
    expect(a.table.localSeats).toEqual([0]);
    expect(b.table.canAct()).toBe(true);
    expect(b.match.hash()).toBe(a.match.hash());
    await playOn(a, b, 3);
  });

  it('rides out a dropped connection, and resends the shot the host never heard', async () => {
    const { a, b, host, guest, links, events } = await game({ firstBreak: 1 });
    // The guest breaks as the connection drops: the shot is lost on the way.
    links.guest.losing = true;
    b.shoot();
    unplug(links.host, links.guest);
    await settle();
    expect(host.state.get().status).toBe('away');
    expect(events.host).toContain('away');
    expect(a.match.current.shot).toBe(0);
    // Nobody plays while the other is away.
    expect(a.table.localSeats).toEqual([]);
    expect(b.table.localSeats).toEqual([]);
    links.guest.losing = false;
    plug(links.host, links.guest);
    await settle();
    expect(host.state.get().status).toBe('playing');
    expect(guest.state.get().status).toBe('playing');
    expect(events.host).toContain('returned');
    expect(a.match.current.shot).toBe(1);
    expect(a.match.hash()).toBe(b.match.hash());
    expect(b.table.localSeats).toEqual([1]);
    await playOn(a, b, 3);
  });

  it('a guest that missed the host’s shot takes the host’s table when it comes back', async () => {
    const { a, b, host, guest, links } = await game();
    links.host.losing = true;
    a.shoot();
    unplug(links.host, links.guest);
    await settle();
    expect(b.match.current.shot).toBe(0);
    links.host.losing = false;
    plug(links.host, links.guest);
    await settle();
    expect(b.match.current.shot).toBe(1);
    expect(b.match.hash()).toBe(a.match.hash());
    // A table taken on a return counts as a difference, on both sides alike.
    expect(guest.state.get().desyncs).toBe(1);
    expect(host.state.get().desyncs).toBe(1);
    await playOn(a, b, 3);
  });

  it('lets a reloaded guest rejoin with its token and catch up from the host', async () => {
    const { a, b, links, host } = await game();
    a.shoot();
    await settle();
    const saved = b.storage.saved!;
    expect(saved.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    unplug(links.host, links.guest);
    await settle();

    const c = device();
    const again = new MemoryLink();
    const { invite: _i, name: _n, ...options } = sessionOptions(c, again, 'Ben');
    const guest = OnlineSession.resume(saved, options);
    plug(links.host, again);
    await settle();
    expect(host.state.get().status).toBe('playing');
    expect(guest.state.get()).toMatchObject({ status: 'playing', friendName: 'Ana' });
    expect(c.match.hash()).toBe(a.match.hash());
    expect(c.table.localSeats).toEqual([1]);
    await playOn(a, c, 3);
  });

  it('a host that reloads picks its own match back up and waits for the guest', async () => {
    const { a, links } = await game();
    a.shoot();
    await settle();
    const saved = a.storage.saved!;
    unplug(links.host, links.guest);
    const c = device();
    const { invite: _i, name: _n, ...options } = sessionOptions(c, new MemoryLink(), 'Ana');
    const host = OnlineSession.resume(saved, options);
    await settle();
    expect(host.state.get().status).toBe('away');
    expect(c.match.hash()).toBe(a.match.hash());
    expect(c.table.localSeats).toEqual([]);
  });

  it('turns away a stranger who comes with the link but without the token', async () => {
    const { a, host, links } = await game();
    unplug(links.host, links.guest);
    await settle();
    const stranger = new MemoryLink();
    plug(links.host, stranger);
    await settle();
    stranger.sendRaw({ t: 'hello', v: 1, build: 'test-build', name: 'Eve' });
    await settle();
    expect(links.host.kicked).toBe(true);
    expect(host.state.get()).toMatchObject({ status: 'away', friendName: 'Ben' });
    expect(a.table.matches).toHaveLength(1);
  });

  it('a guest turns away a stranger posing as the host', async () => {
    const { b, guest, links } = await game();
    unplug(links.host, links.guest);
    await settle();
    const stranger = new MemoryLink();
    plug(stranger, links.guest);
    await settle();
    stranger.sendRaw({ t: 'hello', v: 1, build: 'test-build', name: 'Mallory' });
    await settle();
    expect(links.guest.kicked).toBe(true);
    expect(guest.state.get().friendName).toBe('Ana');
    expect(b.match.current.shot).toBe(0);
  });

  it('asks both players to reload when their builds differ', async () => {
    const a = device();
    const b = device();
    const links = { host: new MemoryLink(), guest: new MemoryLink() };
    const host = hostSession(a, links.host);
    const guest = OnlineSession.join({ ...sessionOptions(b, links.guest, 'Ben'), build: 'newer' });
    plug(links.host, links.guest);
    await settle();
    for (const side of [host, guest]) {
      expect(side.state.get()).toMatchObject({ status: 'failed', message: RELOAD_MESSAGE });
    }
    expect(a.table.matches).toEqual([]);
  });

  it('awards the match when the other player leaves mid-match', async () => {
    const { a, b, host, guest, events } = await game();
    await leave(guest, b);
    expect(a.match.current.winner).toBe(0);
    expect(b.match.current.winner).toBe(0);
    expect(host.state.get()).toMatchObject({ status: 'closed', message: 'Ben left the game.' });
    expect(events.host).toContain('left');
  });

  it('a resignation reaches the other side, which wins the match', async () => {
    const { a, b, guest, events } = await game();
    await guest.resign();
    await settle();
    expect(b.match.current.winner).toBe(0);
    expect(a.match.current.winner).toBe(0);
    expect(events.host).toContain('resigned');
  });

  it('lets the win be claimed after the other player is gone a while', async () => {
    const { a, host, links } = await game();
    unplug(links.host, links.guest);
    await settle();
    a.timers.advance(CLAIM_AFTER_MS - 1);
    expect(host.state.get().canClaimWin).toBe(false);
    a.timers.advance(1);
    expect(host.state.get().canClaimWin).toBe(true);
    await host.claimWin();
    expect(a.match.current.winner).toBe(0);
  });

  it('a guest that cannot find the game gives up with a message', async () => {
    const b = device();
    const guest = guestSession(b, new MemoryLink());
    b.timers.advance(CONNECT_TIMEOUT_MS);
    await settle();
    expect(guest.state.get().status).toBe('failed');
    expect(guest.state.get().message).toMatch(/Couldn't reach the game/);
  });

  it('a guest that connects but is never given a match gives up too', async () => {
    const b = device();
    const link = new MemoryLink();
    const guest = guestSession(b, link);
    plug(link, new MemoryLink());
    await settle();
    expect(guest.state.get().status).toBe('connecting');
    b.timers.advance(CONNECT_TIMEOUT_MS);
    await settle();
    expect(guest.state.get().status).toBe('failed');
  });

  it('a guest dropped before the match is set up gets a fresh while to find it again', async () => {
    const b = device();
    const link = new MemoryLink();
    const guest = guestSession(b, link);
    const other = new MemoryLink();
    b.timers.advance(CONNECT_TIMEOUT_MS - 1_000);
    plug(link, other);
    await settle();
    unplug(link, other);
    await settle();
    b.timers.advance(CONNECT_TIMEOUT_MS - 1_000);
    await settle();
    expect(guest.state.get().status).toBe('connecting');
    b.timers.advance(1_000);
    await settle();
    expect(guest.state.get().status).toBe('failed');
  });

  it('a host keeps the link open after a failed attempt, and the friend can try again', async () => {
    const a = device();
    const b = device();
    const links = { host: new MemoryLink(), guest: new MemoryLink() };
    const host = hostSession(a, links.host);
    links.host.handlers.error("Couldn't connect directly to your friend.");
    await settle();
    expect(host.state.get()).toMatchObject({ status: 'waiting', message: HOST_RETRY_MESSAGE });
    expect(links.host.closed).toBe(false);
    const guest = guestSession(b, links.guest);
    plug(links.host, links.guest);
    await settle();
    expect(host.state.get()).toMatchObject({ status: 'playing', message: null });
    expect(guest.state.get().status).toBe('playing');
  });

  it('a guest whose attempt fails is told why at once', async () => {
    const b = device();
    const link = new MemoryLink();
    const guest = guestSession(b, link);
    link.handlers.error("Couldn't connect directly to your friend.");
    await settle();
    expect(guest.state.get()).toMatchObject({
      status: 'failed',
      message: "Couldn't connect directly to your friend.",
    });
  });

  it('forgets the saved game when the session closes', async () => {
    const { b, guest } = await game();
    expect(b.storage.saved).not.toBeNull();
    await leave(guest, b);
    expect(b.storage.saved).toBeNull();
  });
});

describe('keeping the two tables in step', () => {
  it('a guest whose table came out different stops and takes the host’s', async () => {
    const { a, b, guest, events } = await game();
    nudge(b);
    a.shoot();
    await settle();
    expect(b.match.hash()).toBe(a.match.hash());
    expect(guest.state.get()).toMatchObject({ desyncs: 1, resyncing: false, status: 'playing' });
    expect(events.guest).toContain('resynced');
    await playOn(a, b, 3);
  });

  it('a host whose table came out different has the guest stop, then sends its own', async () => {
    const { a, b, host, guest } = await game({ firstBreak: 1 });
    nudge(a);
    b.shoot();
    await settle();
    expect(b.match.hash()).toBe(a.match.hash());
    expect(host.state.get().desyncs).toBe(1);
    expect(guest.state.get().desyncs).toBe(1);
    await playOn(a, b, 3);
  });

  it(`ends the session, with nobody losing, after more than ${MAX_DESYNCS} differences`, async () => {
    const { a, b, host, guest } = await game();
    for (let i = 0; i <= MAX_DESYNCS; i++) {
      const s = a.match.current;
      if (s.rack.phase === 'decision') {
        (s.rack.turn === 0 ? a : b).match.decide(CHOICES[s.rack.decision!][0]!);
        await settle();
      }
      const shooter = a.match.current.rack.turn === 0 ? a : b;
      nudge(shooter === a ? b : a);
      shooter.shoot(shotFor(shooter.match, 1.2 + i));
      await settle();
    }
    a.timers.advance(1_000);
    b.timers.advance(1_000);
    await settle();
    for (const side of [host, guest]) {
      expect(side.state.get()).toMatchObject({ status: 'closed', message: OUT_OF_STEP_MESSAGE });
      expect(side.state.get().desyncs).toBe(MAX_DESYNCS + 1);
    }
    expect(a.match.current.winner).toBeNull();
    expect(b.match.current.winner).toBeNull();
  });
});

describe('what happens between the two', () => {
  it('counts the rate of messages as they arrive, not as they are handled', async () => {
    const { a, b, host, links } = await game({ firstBreak: 1 });
    // The host's screen is still playing something and will not stop (a tab in the background):
    // the guest's break waits, and its previews pile up behind it.
    a.table.playing = true;
    a.table.stuck = true;
    b.shoot();
    for (let i = 0; i < 60; i++) {
      // Eight a second, as the guest's game sends them while it lines up its next shot.
      links.guest.sendRaw({ t: 'aim', yaw: 1000 + i, pitch: 20, speed: 2000, a: 0, b: 0, pull: 0 });
      a.timers.advance(125);
      await settle(2);
    }
    a.table.stuck = false;
    for (let i = 0; i < 4; i++) {
      a.timers.advance(50);
      await settle();
    }
    expect(host.state.get().status).toBe('playing');
    expect(a.match.hash()).toBe(b.match.hash());
  });

  it('starts the next rack on both sides from the same moment', async () => {
    const { a, b } = await game({ shotClock: 30 });
    // The rack ends alike on both sides (as a pocketed 8 would end it).
    for (const d of [a, b]) {
      const s = d.match.current;
      d.match.state.set({
        ...s,
        score: [1, 0],
        rack: { ...s.rack, phase: 'over', winner: 0, end: 'eight' },
      });
    }
    a.timers.advance(NEXT_RACK_MS);
    b.timers.advance(NEXT_RACK_MS);
    await settle();
    for (const d of [a, b]) {
      expect(d.match.current).toMatchObject({ rackNumber: 2, rack: { phase: 'break', turn: 1 } });
    }
    expect(a.match.hash()).toBe(b.match.hash());
    // The breaker's clock started alike on both: it runs out on the guest's own side first.
    expect(a.port.clockFor(1)!.used).toBe(0);
    expect(b.port.clockFor(1)!.used).toBe(0);
  });

  it('a claimed win ends the session, so the absent player cannot bring their table back', async () => {
    const { a, host, links } = await game();
    unplug(links.host, links.guest);
    await settle();
    a.timers.advance(CLAIM_AFTER_MS);
    await host.claimWin();
    expect(a.match.current.winner).toBe(0);
    expect(host.state.get()).toMatchObject({
      status: 'closed',
      message: 'Ben stayed away, and you claimed the win.',
    });
    expect(links.host.closed).toBe(true);
    expect(a.storage.saved).toBeNull();
  });

  it('no resigning while the other player is away (their table would undo it)', async () => {
    const { a, guest, links } = await game();
    unplug(links.host, links.guest);
    await settle();
    await guest.resign();
    expect(a.match.current.winner).toBeNull();
    expect(guest.state.get().status).toBe('away');
  });

  it('a rematch asked while the other player was away still starts on both sides', async () => {
    const { a, b, host, guest, links } = await game();
    await host.resign();
    await settle();
    unplug(links.host, links.guest);
    await settle();
    // Ana asks while Ben cannot hear it: her request is lost.
    await host.requestRematch();
    plug(links.host, links.guest);
    await settle();
    // Ben asks in turn: both start, once each.
    await guest.requestRematch();
    await settle();
    expect(a.table.matches).toHaveLength(2);
    expect(b.table.matches).toEqual(a.table.matches);
    expect(a.match.hash()).toBe(b.match.hash());
    expect(host.state.get().rematch).toBe('none');
    expect(guest.state.get().rematch).toBe('none');
  });

  it('a stranger with the link and another build cannot end a session they are not part of', async () => {
    const { host, links } = await game();
    unplug(links.host, links.guest);
    await settle();
    const stranger = new MemoryLink();
    plug(links.host, stranger);
    await settle();
    stranger.sendRaw({ t: 'hello', v: 1, build: 'some-other-build', name: 'Eve' });
    await settle();
    expect(links.host.kicked).toBe(true);
    expect(host.state.get()).toMatchObject({ status: 'away', message: null });
  });
});
