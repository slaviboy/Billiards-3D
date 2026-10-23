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

// The game's messages: every shape is accepted exactly and nothing else is, and a table at rest
// travels in a sync message and comes back the same to the last bit.

import { describe, expect, it } from 'vitest';
import {
  BALL_COUNT,
  POOL_CODEC,
  nextSeed,
  parsePoolMessage,
  parseSyncMessage,
  parseTerms,
  rematchTerms,
  setupFor,
  shotInRange,
  shotMessage,
  stateFromSync,
  syncMessage,
  type PoolTerms,
  type ShotMessage,
  type SyncMessage,
} from '../../../src/game/gameMessages.ts';
import { MatchController, type MatchState } from '../../../src/game/MatchController.ts';
import { MAX_OFFSET, MAX_SPEED, encodeShot } from '../../../src/game/shotCodec.ts';
import { MAX_MESSAGE_BYTES, parseMessage, setupMessage } from '../../../src/net/protocol.ts';

const HASH = '0123456789abcdef';
const SAMPLE_ID = 'abcdefghijklmnopqrstuv';

const terms: PoolTerms = {
  seed: '00112233aabbccdd',
  race: 3,
  shotClock: 30,
  size: '9ft',
  names: ['Ana', 'Ben'],
  host: 0,
  firstBreak: 0,
};

const plain = { pocket: null, safety: false };

/** A hard break straight at the apex from the cue ball's spot. */
function breakShot(match: MatchController) {
  const cue = match.current.balls[0]!;
  const heading = Math.atan2(match.table.footSpot.y - cue.ry, match.table.footSpot.x - cue.rx);
  return encodeShot(heading, 0, 7, 0, -0.1);
}

/** A match some shots in: the break and a few soft shots up the table. */
function played(shots = 3): MatchController {
  const match = new MatchController(setupFor(terms));
  match.shoot(breakShot(match), plain);
  for (let i = 0; i < shots; i++) {
    const s = match.current;
    if (s.rack.phase === 'decision')
      match.decide(s.rack.decision === 'illegalBreak' ? 'accept' : 'spot');
    if (match.current.rack.phase !== 'play') break;
    const cue = match.current.balls[0]!;
    const place = match.inHand() ? { x: cue.rx, y: cue.ry } : null;
    match.shoot(
      encodeShot(1.3 + i * 0.4, 2, 1.5, 0.1, 0),
      { pocket: match.needsCall() ? 0 : null, safety: false },
      place ? { x: Math.round(place.x * 1e5), y: Math.round(place.y * 1e5) } : null,
    );
  }
  return match;
}

/** A message as it arrives: through JSON, then the session's parser. */
const arrive = (message: object) => parseMessage(JSON.parse(JSON.stringify(message)), POOL_CODEC);

describe('the game messages', () => {
  it('accepts every message in its exact shape', () => {
    const code = { yaw: 12345, pitch: 30, speed: 4000, a: -120, b: 250 };
    const valid = [
      shotMessage(0, code, null, false, null, HASH),
      shotMessage(7, code, 5, true, { x: 63500, y: 40000 }, HASH),
      { t: 'aim', ...code, pull: 0 },
      { t: 'aim', ...code, pull: 1000 },
      { t: 'place', x: 63500, y: 40000 },
      { t: 'decide', n: 1, choice: 'rerackOther' },
      { t: 'timeout', n: 4 },
    ];
    for (const message of valid) expect(arrive(message)).toEqual(message);
  });

  it('drops extra, missing and wrongly typed fields', () => {
    const shot = shotMessage(
      3,
      { yaw: 1, pitch: 0, speed: 100, a: 0, b: 0 },
      null,
      false,
      null,
      HASH,
    );
    const bad = [
      { ...shot, n: -1 },
      { ...shot, n: 1.5 },
      { ...shot, yaw: 1.5 },
      { ...shot, yaw: 2 ** 40 },
      { ...shot, speed: '100' },
      { ...shot, b: null },
      { ...shot, x: 100 },
      { ...shot, y: 100 },
      { ...shot, x: 1.5, y: 100 },
      { ...shot, x: 2_000_000, y: 100 },
      { ...shot, pocket: 1.5 },
      { ...shot, pocket: '1' },
      { ...shot, pocket: undefined },
      { ...shot, safety: 'no' },
      { ...shot, h: 'ABCDEF0123456789' },
      { ...shot, h: '0123' },
      { ...shot, extra: 1 },
      { t: 'aim', yaw: 1, pitch: 0, speed: 100, a: 0, b: 0, pull: 1001 },
      { t: 'aim', yaw: 1, pitch: 0, speed: 100, a: 0, b: 0 },
      { t: 'place', x: 1.5, y: 0 },
      { t: 'place', x: 1 },
      { t: 'decide', n: 0, choice: 'pass' },
      { t: 'decide', choice: 'accept' },
      { t: 'timeout' },
      { t: 'timeout', n: 0, seat: 1 },
      { t: 'nonsense' },
    ];
    for (const data of bad) {
      const raw = JSON.parse(JSON.stringify(data));
      expect(parseMessage(raw, POOL_CODEC), JSON.stringify(data)).toBeNull();
    }
    // undefined does not survive JSON, but an object can hold it.
    expect(parsePoolMessage({ ...shot, pocket: undefined })).toBeNull();
  });

  it('lets a well-formed shot out of the cue’s range through, for the receiver to refuse', () => {
    const shot = shotMessage(
      3,
      { yaw: 1, pitch: 0, speed: 100, a: 0, b: 0 },
      null,
      false,
      null,
      HASH,
    );
    expect(shotInRange(shot)).toBe(true);
    expect(shotInRange({ ...shot, pocket: 5 })).toBe(true);
    for (const patch of [
      { yaw: -1 },
      { yaw: 1 << 20 },
      { pitch: 601 },
      { speed: 49 },
      { speed: MAX_SPEED + 1 },
      { a: MAX_OFFSET + 1 },
      // Within each limit, but beyond the miscue circle.
      { a: 400, b: 400 },
      { pocket: 6 },
      { pocket: -1 },
    ]) {
      const message = arrive({ ...shot, ...patch });
      expect(message, JSON.stringify(patch)).not.toBeNull();
      expect(shotInRange(message as ShotMessage), JSON.stringify(patch)).toBe(false);
    }
  });

  it('returns fresh objects, never the received ones', () => {
    const match = played(0);
    const raw = JSON.parse(JSON.stringify(syncMessage(match.current, match.hash())));
    const parsed = arrive(raw) as SyncMessage;
    raw.balls[0][0] = 99;
    expect(parsed.balls[0]![0]).not.toBe(99);
  });
});

describe('the host’s terms', () => {
  it('travel in a setup message and come back the same, names cleaned', () => {
    const wire = setupMessage(SAMPLE_ID, terms);
    expect(arrive(wire)).toEqual({ t: 'setup', token: SAMPLE_ID, terms });
    expect(parseTerms({ ...terms, names: [' Ana‮ ', ''] })?.names).toEqual(['Ana', 'Player 2']);
  });

  it('refuse anything outside what a match can be', () => {
    for (const patch of [
      { seed: 'welcome' },
      { seed: '00112233AABBCCDD' },
      { race: 0 },
      { race: 16 },
      { race: 2.5 },
      { shotClock: 5 },
      { shotClock: 301 },
      { size: '8ft' },
      { names: ['Ana'] },
      { names: ['Ana', 7] },
      { names: ['Ana', 'x'.repeat(200)] },
      { host: 2 },
      { firstBreak: -1 },
    ]) {
      expect(parseTerms({ ...terms, ...patch }), JSON.stringify(patch)).toBeNull();
    }
    expect(parseTerms({ ...terms, extra: true })).toBeNull();
    const { seed: _seed, ...missing } = terms;
    expect(parseTerms(missing)).toBeNull();
  });

  it('give a rematch on a fresh seed, the same on both sides, the other player breaking', () => {
    const again = rematchTerms(terms);
    expect(again).toEqual({ ...terms, seed: nextSeed(terms.seed), firstBreak: 1 });
    expect(again.seed).toMatch(/^[0-9a-f]{16}$/);
    expect(again.seed).not.toBe(terms.seed);
    expect(rematchTerms(again).firstBreak).toBe(0);
    expect(parseTerms({ ...again })).toEqual(again);
  });
});

describe('the table at rest', () => {
  function roundTrip(match: MatchController): MatchState | null {
    const sent = syncMessage(match.current, match.hash());
    const received = arrive(sent);
    expect(received).toEqual(sent);
    return stateFromSync(received as SyncMessage, match.current.setup, match.table);
  }

  it('comes back to the last bit, at the start, after the break and after play', () => {
    const fresh = new MatchController(setupFor(terms));
    const later = played(5);
    expect(later.current.shot).toBeGreaterThan(3);
    for (const match of [fresh, played(0), played(2), later]) {
      const state = roundTrip(match)!;
      expect(state).not.toBeNull();
      expect(match.hash(state)).toBe(match.hash());
      // And the next shot from it plays the same.
      const copy = new MatchController(setupFor(terms));
      copy.state.set(state);
      if (match.current.rack.phase === 'play' || match.current.rack.phase === 'break') {
        const code = encodeShot(2.1, 0, 2, 0, 0);
        const cue = match.current.balls[0]!;
        const place = match.inHand()
          ? { x: Math.round(cue.rx * 1e5), y: Math.round(cue.ry * 1e5) }
          : null;
        const intent = { pocket: match.needsCall() ? 1 : null, safety: false } as const;
        match.shoot(code, intent, place);
        copy.shoot(code, intent, place);
        expect(copy.hash()).toBe(match.hash());
      }
    }
  });

  it('fits the message limit with room to spare, whatever the numbers', () => {
    const match = played(1);
    const sync = syncMessage(match.current, match.hash());
    // The longest numbers JSON writes for coordinates on the table.
    const worst = {
      ...sync,
      n: 999_999,
      balls: Array.from({ length: BALL_COUNT }, () => [
        -0.012345678901234567, 1.2345678901234567, 1,
      ]),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(worst)).length;
    expect(bytes).toBeLessThan(MAX_MESSAGE_BYTES / 2);
  });

  it('refuses a table that could not be this match’s', () => {
    const match = played(1);
    const good = syncMessage(match.current, match.hash());
    const W = match.table.spec.W;
    const ball = (x: number, y: number, p: 0 | 1 = 0) =>
      good.balls.map((b, i) => (i === 3 ? ([x, y, p] as const) : b));
    for (const patch of [
      { score: [4, 0] },
      { score: [3, 0], rack: 4 },
      { rack: 6 },
      { score: [1, 0] },
      { groups: [1, 1] },
      { groups: [0, 2] },
      { phase: 'play', decision: 'illegalBreak' },
      { phase: 'decision', decision: null },
      { phase: 'play', winner: 0 },
      { phase: 'play', end: 'eight' },
      { phase: 'play', match: 0 },
      { phase: 'break', turn: 1 - good.breaker },
      { phase: 'break', inHand: 'table' },
      { balls: ball(W + 0.01, 1) },
      { balls: ball(-0.01, 1) },
      { balls: ball(W + 1, 1, 1) },
    ] as Partial<SyncMessage>[]) {
      const sync = { ...good, ...patch } as SyncMessage;
      expect(stateFromSync(sync, match.current.setup, match.table), JSON.stringify(patch)).toBe(
        null,
      );
    }
  });

  it('reads a saved table like a received one', () => {
    const match = played(1);
    const saved = JSON.parse(JSON.stringify(syncMessage(match.current, match.hash())));
    expect(parseSyncMessage(saved)).toEqual(saved);
    expect(parseSyncMessage({ ...saved, balls: saved.balls.slice(1) })).toBeNull();
    expect(parseSyncMessage({ ...saved, t: 'shot' })).toBeNull();
    expect(parseSyncMessage(null)).toBeNull();
    const nan = { ...saved, balls: [[NaN, 1, 0], ...saved.balls.slice(1)] };
    expect(parseSyncMessage(nan)).toBeNull();
    const two = { ...saved, balls: [[1, 1, 2], ...saved.balls.slice(1)] };
    expect(parseSyncMessage(two)).toBeNull();
  });
});
