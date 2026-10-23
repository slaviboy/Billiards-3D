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

// What an online match of 8-ball says on top of the session's envelope (src/net/protocol.ts): the
// host's terms, the shots, the previews of the cue, the break's decisions, time-outs and the
// table at rest. A shot is integers only, the same ones the shooter's own simulation started from,
// with the fingerprint of the table it led to; nothing the other side sends is a result to take on
// trust, except the host's table when the two have to be brought back in step.
//
// parsePoolMessage and parseTerms accept the exact shapes below and nothing else: what is not one of
// them is noise, dropped and counted by the guard. A shot of the right shape is checked by the
// port, against this device's own match: the cue's values in range (shotInRange), whose turn,
// which shot, where the cue ball may go, the 8's call; failing any of those is a rule break.

import {
  MAX_COUNT,
  cleanName,
  hasKeys,
  isInt,
  isObject,
  type GameCodec,
  type Raw,
  type SessionMessage,
} from '../net/protocol.ts';
import { ballState, Motion, POCKET_DEPTH, type BallState } from '../physics/state.ts';
import type { PocketId } from '../physics/types.ts';
import { other } from '../rules/eightBall.ts';
import {
  CHOICES,
  type Choice,
  type DecisionKind,
  type Group,
  type InHand,
  type Phase,
  type RackEnd,
  type RackState,
  type Seat,
} from '../rules/types.ts';
import { seedFrom } from '../table/rack.ts';
import { BALL_RADIUS, isTableSize, type TableSize } from '../table/spec.ts';
import type { TableGeometry } from '../table/geometry.ts';
import type { MatchSetup, MatchState } from './MatchController.ts';
import { isPocketId, isShotCode, type Placement, type ShotCode } from './shotCodec.ts';

/** The most racks a race can ask for. */
export const MAX_RACE = 15;
/** The longest shot clock, in seconds. */
export const MAX_SHOT_CLOCK = 300;
/** A placement's coordinates, in its 10 µm units, lie within ±10 m. */
export const MAX_PLACEMENT = 1_000_000;
/** The number of balls on the table, the cue ball first. */
export const BALL_COUNT = 16;

/** What the host chooses for an online match, as for a match on one device. */
export interface PoolTerms {
  /** Shared by both players: decides the racks. 16 hexadecimal digits. */
  readonly seed: string;
  readonly race: number;
  /** Seconds per shot; 0 for none. */
  readonly shotClock: number;
  readonly size: TableSize;
  /** The two seats' names, the host's and the guest's. */
  readonly names: readonly [string, string];
  /** The host's seat; the guest has the other one. */
  readonly host: Seat;
  readonly firstBreak: Seat;
}

/** The table at rest, as it travels: enough to rebuild the match state bit for bit. */
export interface SyncMessage {
  readonly t: 'sync';
  /** Shots played in the match. */
  readonly n: number;
  /** The rack's number, 1 for the first. */
  readonly rack: number;
  readonly score: readonly [number, number];
  readonly phase: Phase;
  readonly breaker: Seat;
  readonly turn: Seat;
  readonly groups: readonly [Group, Group];
  readonly inHand: InHand;
  readonly decision: DecisionKind | null;
  /** The rack's winner, once it is over. */
  readonly winner: Seat | null;
  readonly end: RackEnd | null;
  /** The match's winner, once it is over. */
  readonly match: Seat | null;
  /** Each ball's position and whether it has been pocketed (1) or not (0), the cue ball first. */
  readonly balls: readonly (readonly [number, number, 0 | 1])[];
  /** The sender's fingerprint of this state. */
  readonly h: string;
}

export type GameMessage =
  /**
   * A shot by the sender: its index in the match, the cue as integers (see shotCodec), the cue
   * ball's placement when it was in hand, the 8's called pocket (null when none is due), the
   * safety call, and the fingerprint of the table it led to.
   */
  | {
      readonly t: 'shot';
      readonly n: number;
      readonly yaw: number;
      readonly pitch: number;
      readonly speed: number;
      readonly a: number;
      readonly b: number;
      readonly x?: number;
      readonly y?: number;
      /** A PocketId once the receiver has checked it (shotInRange). */
      readonly pocket: number | null;
      readonly safety: boolean;
      readonly h: string;
    }
  /** Where the shooter's cue is (pull: how far it is drawn back, in thousandths). */
  | {
      readonly t: 'aim';
      readonly yaw: number;
      readonly pitch: number;
      readonly speed: number;
      readonly a: number;
      readonly b: number;
      readonly pull: number;
    }
  /** Where the shooter is putting the cue ball in hand, in 10 µm units. */
  | { readonly t: 'place'; readonly x: number; readonly y: number }
  /** The deciding player's answer to a choice the break left, before shot `n`. */
  | { readonly t: 'decide'; readonly n: number; readonly choice: Choice }
  /** The sender's own shot clock ran out before shot `n`. */
  | { readonly t: 'timeout'; readonly n: number }
  | SyncMessage;

export type ShotMessage = Extract<GameMessage, { t: 'shot' }>;
export type PoolMessage = SessionMessage<PoolTerms> | GameMessage;

const HASH = /^[0-9a-f]{16}$/;
const SEED = /^[0-9a-f]{16}$/;
const PHASES: readonly Phase[] = ['break', 'play', 'decision', 'over'];
const IN_HAND: readonly InHand[] = ['none', 'kitchen', 'table'];
const DECISIONS = Object.keys(CHOICES) as DecisionKind[];
const ENDS: readonly RackEnd[] = ['eight', 'eightEarly', 'eightFoul', 'eightPocket', 'concede'];
const ALL_CHOICES: readonly Choice[] = ['accept', 'rerack', 'rerackOther', 'spot', 'rebreak'];
/** The most racks a match can reach: every rack but the last won by alternate players. */
const MAX_RACKS = 2 * MAX_RACE - 1;
/** No coordinate of a ball at rest is this far from the table's corner, in metres. */
const MAX_COORD = 10;

const isSeat = (value: unknown): value is Seat => value === 0 || value === 1;
const isGroup = (value: unknown): value is Group => value === 0 || value === 1 || value === 2;
const isHash = (value: unknown): value is string => typeof value === 'string' && HASH.test(value);
const oneOf = <T>(value: unknown, options: readonly T[]): value is T =>
  options.includes(value as T);
const pair = <T>(value: unknown, item: (v: unknown) => v is T): value is [T, T] =>
  Array.isArray(value) && value.length === 2 && item(value[0]) && item(value[1]);
const isCoord = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORD;

/** The host's terms, if the data is exactly them; null otherwise. */
export function parseTerms(data: Raw): PoolTerms | null {
  if (!hasKeys(data, ['seed', 'race', 'shotClock', 'size', 'names', 'host', 'firstBreak'])) {
    return null;
  }
  const { seed, race, shotClock, size, names, host, firstBreak } = data;
  if (typeof seed !== 'string' || !SEED.test(seed)) return null;
  if (!isInt(race, 1, MAX_RACE)) return null;
  if (!(shotClock === 0 || isInt(shotClock, 10, MAX_SHOT_CLOCK))) return null;
  if (!isTableSize(size) || !isSeat(host) || !isSeat(firstBreak)) return null;
  const isName = (v: unknown): v is string => typeof v === 'string' && v.length <= 96;
  if (!pair(names, isName)) return null;
  return {
    seed,
    race,
    shotClock,
    size,
    names: [cleanName(names[0], 'Player 1'), cleanName(names[1], 'Player 2')],
    host,
    firstBreak,
  };
}

/** One of the game's messages, if the data is exactly one; null for anything else. */
export function parsePoolMessage(data: Raw): GameMessage | null {
  switch (data.t) {
    case 'shot': {
      if (
        !hasKeys(
          data,
          ['t', 'n', 'yaw', 'pitch', 'speed', 'a', 'b', 'pocket', 'safety', 'h'],
          ['x', 'y'],
        )
      ) {
        return null;
      }
      const code = wholeCode(data);
      if (!isInt(data.n, 0, MAX_COUNT) || !code) return null;
      const placed = Object.hasOwn(data, 'x');
      if (placed !== Object.hasOwn(data, 'y')) return null;
      if (placed && !(isPlacementUnit(data.x) && isPlacementUnit(data.y))) return null;
      if (data.pocket !== null && !isWhole(data.pocket)) return null;
      if (typeof data.safety !== 'boolean' || !isHash(data.h)) return null;
      return {
        t: 'shot',
        n: data.n,
        ...code,
        ...(placed ? { x: data.x as number, y: data.y as number } : {}),
        pocket: data.pocket,
        safety: data.safety,
        h: data.h,
      };
    }
    case 'aim': {
      if (!hasKeys(data, ['t', 'yaw', 'pitch', 'speed', 'a', 'b', 'pull'])) return null;
      const code = wholeCode(data);
      if (!code || !isInt(data.pull, 0, 1000)) return null;
      return { t: 'aim', ...code, pull: data.pull };
    }
    case 'place':
      if (!hasKeys(data, ['t', 'x', 'y'])) return null;
      if (!isPlacementUnit(data.x) || !isPlacementUnit(data.y)) return null;
      return { t: 'place', x: data.x, y: data.y };
    case 'decide':
      if (!hasKeys(data, ['t', 'n', 'choice']) || !isInt(data.n, 0, MAX_COUNT)) return null;
      if (!oneOf(data.choice, ALL_CHOICES)) return null;
      return { t: 'decide', n: data.n, choice: data.choice };
    case 'timeout':
      if (!hasKeys(data, ['t', 'n']) || !isInt(data.n, 0, MAX_COUNT)) return null;
      return { t: 'timeout', n: data.n };
    case 'sync':
      return parseSync(data);
    default:
      return null;
  }
}

function isPlacementUnit(value: unknown): value is number {
  return isInt(value, -MAX_PLACEMENT, MAX_PLACEMENT);
}

/** A whole number a 32-bit integer can hold. */
function isWhole(value: unknown): value is number {
  return isInt(value, -0x80000000, 0x7fffffff);
}

/**
 * The cue's five integers, if they are whole numbers. Whether they lie in the cue's range is the
 * receiver's check (isShotCode), against which a shot out of range is a rule break, not noise.
 */
function wholeCode(data: Raw): ShotCode | null {
  const { yaw, pitch, speed, a, b } = data;
  if (!isWhole(yaw) || !isWhole(pitch) || !isWhole(speed) || !isWhole(a) || !isWhole(b)) {
    return null;
  }
  return { yaw, pitch, speed, a, b };
}

/** Whether a received shot's values are all within what the cue and the table allow. */
export function shotInRange(message: { readonly pocket?: number | null } & ShotCode): boolean {
  const code = {
    yaw: message.yaw,
    pitch: message.pitch,
    speed: message.speed,
    a: message.a,
    b: message.b,
  };
  return isShotCode(code) && (message.pocket == null || isPocketId(message.pocket));
}

const SYNC_KEYS = [
  't',
  'n',
  'rack',
  'score',
  'phase',
  'breaker',
  'turn',
  'groups',
  'inHand',
  'decision',
  'winner',
  'end',
  'match',
  'balls',
  'h',
];

function parseSync(data: Raw): SyncMessage | null {
  if (!hasKeys(data, SYNC_KEYS)) return null;
  const d = data;
  const count = (v: unknown): v is number => isInt(v, 0, MAX_RACKS);
  if (!isInt(d.n, 0, MAX_COUNT) || !isInt(d.rack, 1, MAX_RACKS) || !pair(d.score, count)) {
    return null;
  }
  if (!oneOf(d.phase, PHASES) || !isSeat(d.breaker) || !isSeat(d.turn)) return null;
  if (!pair(d.groups, isGroup) || !oneOf(d.inHand, IN_HAND)) return null;
  if (d.decision !== null && !oneOf(d.decision, DECISIONS)) return null;
  if (d.winner !== null && !isSeat(d.winner)) return null;
  if (d.end !== null && !oneOf(d.end, ENDS)) return null;
  if (d.match !== null && !isSeat(d.match)) return null;
  if (!Array.isArray(d.balls) || d.balls.length !== BALL_COUNT || !isHash(d.h)) return null;
  const balls: [number, number, 0 | 1][] = [];
  for (const ball of d.balls as unknown[]) {
    if (!Array.isArray(ball) || ball.length !== 3) return null;
    const [x, y, p] = ball as unknown[];
    if (!isCoord(x) || !isCoord(y) || (p !== 0 && p !== 1)) return null;
    balls.push([x, y, p]);
  }
  return {
    t: 'sync',
    n: d.n,
    rack: d.rack,
    score: [d.score[0], d.score[1]],
    phase: d.phase,
    breaker: d.breaker,
    turn: d.turn,
    groups: [d.groups[0], d.groups[1]],
    inHand: d.inHand,
    decision: d.decision,
    winner: d.winner,
    end: d.end,
    match: d.match,
    balls,
    h: d.h,
  };
}

/** How the session reads 8-ball's messages and terms. */
export const POOL_CODEC: GameCodec<GameMessage, PoolTerms> = {
  parse: parsePoolMessage,
  parseTerms,
};

/** Whether the data is a sync message, exactly (a saved game is checked like a received one). */
export function parseSyncMessage(data: unknown): SyncMessage | null {
  return isObject(data) && data.t === 'sync' ? parseSync(data) : null;
}

// --- between messages and the match ----------------------------------------------------------

/** The match's terms on this device. */
export function setupFor(terms: PoolTerms): MatchSetup {
  return {
    mode: 'online',
    size: terms.size,
    race: terms.race,
    shotClock: terms.shotClock,
    names: terms.names,
    seed: terms.seed,
    firstBreak: terms.firstBreak,
  };
}

/** A fresh seed, the same on both sides, from the one before (for a rematch). */
export function nextSeed(seed: string): string {
  const hex = (n: number) => n.toString(16).padStart(8, '0');
  return hex(seedFrom(`${seed}:rematch:a`)) + hex(seedFrom(`${seed}:rematch:b`));
}

/** A rematch: the same terms on a fresh seed, the other player breaking first. */
export function rematchTerms(terms: PoolTerms): PoolTerms {
  return { ...terms, seed: nextSeed(terms.seed), firstBreak: other(terms.firstBreak) };
}

export function shotMessage(
  n: number,
  code: ShotCode,
  pocket: PocketId | null,
  safety: boolean,
  placement: Placement | null,
  h: string,
): ShotMessage {
  return {
    t: 'shot',
    n,
    yaw: code.yaw,
    pitch: code.pitch,
    speed: code.speed,
    a: code.a,
    b: code.b,
    ...(placement ? { x: placement.x, y: placement.y } : {}),
    pocket,
    safety,
    h,
  };
}

/** The table at rest as a sync message. */
export function syncMessage(state: MatchState, h: string): SyncMessage {
  const r = state.rack;
  return {
    t: 'sync',
    n: state.shot,
    rack: state.rackNumber,
    score: [state.score[0], state.score[1]],
    phase: r.phase,
    breaker: r.breaker,
    turn: r.turn,
    groups: [r.groups[0], r.groups[1]],
    inHand: r.inHand,
    decision: r.decision,
    winner: r.winner,
    end: r.end,
    match: state.winner,
    balls: state.balls.map((b) => [b.rx, b.ry, b.s === Motion.Pocketed ? 1 : 0] as const),
    h,
  };
}

/**
 * The match state a sync message describes, for this match's terms and table; null when it could
 * not be a state of this match (a score beyond the race, a ball off the table, a decision without
 * a decision phase and the like). Whether it is the sender's actual table is for the fingerprint
 * to tell: the caller compares the rebuilt state's hash with `h`.
 */
export function stateFromSync(
  sync: SyncMessage,
  setup: MatchSetup,
  table: TableGeometry,
): MatchState | null {
  const { race } = setup;
  const [s0, s1] = sync.score;
  if (sync.rack > 2 * race - 1 || s0 > race || s1 > race) return null;
  // Every rack before this one was won by someone; this one too once it is over, unless the match
  // ended there by a resignation.
  const before = sync.rack - 1;
  if (!(s0 + s1 === before || (sync.phase === 'over' && s0 + s1 === sync.rack))) return null;
  if (sync.match === null && (s0 >= race || s1 >= race)) return null;
  if (sync.match !== null && sync.phase !== 'over') return null;
  const [g0, g1] = sync.groups;
  if (!((g0 === 0 && g1 === 0) || (g0 !== 0 && g1 !== 0 && g0 !== g1))) return null;
  if ((sync.decision !== null) !== (sync.phase === 'decision')) return null;
  if ((sync.winner !== null) !== (sync.phase === 'over')) return null;
  if ((sync.end !== null) !== (sync.phase === 'over')) return null;
  // A break is the breaker's, from the kitchen, on an open table.
  if (
    sync.phase === 'break' &&
    (sync.turn !== sync.breaker || sync.inHand !== 'kitchen' || g0 !== 0)
  ) {
    return null;
  }
  const { W, L } = table.spec;
  const reach = 0.3;
  const balls: BallState[] = [];
  for (const [x, y, pocketed] of sync.balls) {
    if (pocketed) {
      if (x < -reach || x > W + reach || y < -reach || y > L + reach) return null;
      balls.push({ ...ballState(x, y, -POCKET_DEPTH), s: Motion.Pocketed });
    } else {
      if (x < 0 || x > W || y < 0 || y > L) return null;
      balls.push(ballState(x, y, BALL_RADIUS));
    }
  }
  const rack: RackState = {
    phase: sync.phase,
    breaker: sync.breaker,
    turn: sync.turn,
    groups: [g0, g1],
    inHand: sync.inHand,
    decision: sync.decision,
    winner: sync.winner,
    end: sync.end,
  };
  return {
    setup,
    rack,
    rackNumber: sync.rack,
    score: [s0, s1],
    shot: sync.n,
    balls,
    ruling: null,
    winner: sync.match,
  };
}
