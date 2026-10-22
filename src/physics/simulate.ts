/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * This file is part of Pool.
 *
 * Pool is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version. See the LICENSE file for the full terms.
 *
 * Translated and changed from pooltool (pooltool/evolution/event_based/simulate.py,
 * pooltool/evolution/event_based/cache.py, pooltool/physics/resolve/ball_pocket/__init__.py,
 * pooltool/physics/resolve/transition/__init__.py), Apache License 2.0; see NOTICE.md.
 */

// A whole shot, event by event. Between events every ball follows its closed-form path, so the
// simulation jumps from one event to the next: the cue strikes, a ball changes from sliding to
// rolling, two balls meet, a ball meets a cushion or drops into a pocket. Each step finds the
// earliest of all possible next events, moves every ball to that moment, resolves the event, and
// forgets the predictions that involved the balls it changed (pooltool's caches). The shot ends
// when nothing is moving.
//
// Simultaneous events are ordered as pooltool orders them: the cue first, then changes of motion
// and pockets, then collisions; within a tier the more energetic first; then (unlike pooltool,
// whose order there follows its dictionaries) by kind and by ball and cushion number, so the
// order is fixed.

import { ballBallTime, circularCushionTime, linearCushionTime, pocketTime } from './detect.ts';
import { energy, evolve, rollTime, slideTime, spinTime } from './motion.ts';
import { hitBalls } from './resolve/ballBall.ts';
import { hitCircular, hitLinear } from './resolve/cushion.ts';
import { type Strike, strike } from './resolve/stick.ts';
import {
  type BallParams,
  type BallState,
  type CueParams,
  copyState,
  Motion,
  POCKET_DEPTH,
  POOL_BALL,
  POOL_CUE,
} from './state.ts';
import type { PhysicsTable, PocketId } from './types.ts';

export type PhysicsEvent =
  | { readonly kind: 'stick'; readonly t: number; readonly ball: number }
  | {
      readonly kind: 'ball';
      readonly t: number;
      readonly a: number;
      readonly b: number;
      /** Speed of approach along the line of centres. */
      readonly impact: number;
    }
  | {
      readonly kind: 'cushion';
      readonly t: number;
      readonly ball: number;
      /** A straight cushion's id (rails 0–5, facings 6–17). */
      readonly cushion: number;
      readonly impact: number;
    }
  | {
      readonly kind: 'jaw';
      readonly t: number;
      readonly ball: number;
      /** A lip circle's id (0–11). */
      readonly jaw: number;
      readonly impact: number;
    }
  | {
      readonly kind: 'pocket';
      readonly t: number;
      readonly ball: number;
      readonly pocket: PocketId;
      /** The ball as it reached the pocket: where it drops from and how fast. */
      readonly entry: Readonly<BallState>;
    }
  | {
      readonly kind: 'transition';
      readonly t: number;
      readonly ball: number;
      readonly from: Motion;
      readonly to: Motion;
    };

export interface Timeline {
  readonly events: readonly PhysicsEvent[];
  /** Per ball, its states in time order; each holds from its `t` until the next one. */
  readonly segments: readonly (readonly Readonly<BallState>[])[];
  /** Every ball at the end, all at rest or pocketed. */
  readonly final: readonly Readonly<BallState>[];
  readonly duration: number;
  /** The event limit was reached and the balls were stopped where they were. */
  readonly truncated: boolean;
}

export interface SimulateOptions {
  readonly params?: BallParams;
  readonly cue?: CueParams;
  readonly maxEvents?: number;
}

/** Kinds of candidate event, in the order that breaks exact ties. */
const Kind = { Transition: 0, BallBall: 1, Circular: 2, Linear: 3, Pocket: 4 } as const;
type Kind = (typeof Kind)[keyof typeof Kind];

/**
 * Simulates a shot from balls at rest (or moving), struck by the cue if `shot` is given, until
 * everything stops. Deterministic: the same input gives the same output, bit for bit, everywhere.
 */
export function simulate(
  initial: readonly Readonly<BallState>[],
  shot: Strike | null,
  table: PhysicsTable,
  options: SimulateOptions = {},
): Timeline {
  const p = options.params ?? POOL_BALL;
  const cue = options.cue ?? POOL_CUE;
  const maxEvents = options.maxEvents ?? 10000;
  const n = initial.length;
  const nl = table.linear.length;
  const nc = table.circular.length;
  const np = table.pockets.length;

  const balls = initial.map((b) => ({ ...copyState(b), t: 0 }));
  const segments: BallState[][] = balls.map((b) => [copyState(b)]);
  const events: PhysicsEvent[] = [];
  let now = 0;

  if (shot) {
    const b = balls[shot.ball]!;
    strike(b, shot, p, cue);
    segments[shot.ball] = [copyState(b)];
    events.push({ kind: 'stick', t: 0, ball: shot.ball });
  }

  // Next change of motion of each ball (absolute time) and what it changes to.
  const transitionAt = new Float64Array(n);
  const transitionTo = new Int8Array(n);
  const updateTransition = (i: number) => {
    const b = balls[i]!;
    switch (b.s) {
      case Motion.Sliding:
        transitionAt[i] = b.t + slideTime(b, p);
        transitionTo[i] = Motion.Rolling;
        break;
      case Motion.Rolling: {
        const roll = rollTime(b, p);
        transitionAt[i] = b.t + roll;
        transitionTo[i] = spinTime(b, p) > roll ? Motion.Spinning : Motion.Stationary;
        break;
      }
      case Motion.Spinning:
        transitionAt[i] = b.t + spinTime(b, p);
        transitionTo[i] = Motion.Stationary;
        break;
      default:
        transitionAt[i] = Infinity;
    }
  };
  for (let i = 0; i < n; i++) updateTransition(i);

  // Predicted collision times (absolute); NaN where not yet computed.
  const ballBall = new Float64Array(n * n).fill(NaN);
  const linear = new Float64Array(n * nl).fill(NaN);
  const circular = new Float64Array(n * nc).fill(NaN);
  const pocket = new Float64Array(n * np).fill(NaN);
  const forget = (i: number) => {
    for (let j = 0; j < n; j++) ballBall[i * n + j] = ballBall[j * n + i] = NaN;
    linear.fill(NaN, i * nl, (i + 1) * nl);
    circular.fill(NaN, i * nc, (i + 1) * nc);
    pocket.fill(NaN, i * np, (i + 1) * np);
  };

  // The best candidate so far.
  let bestTime = Infinity;
  let bestTier = 99;
  let bestEnergy = 0;
  let bestKind = Kind.Transition as Kind;
  let bestI = -1;
  let bestJ = -1;
  const offer = (time: number, tier: number, e: number, kind: Kind, i: number, j: number) => {
    if (!(time <= bestTime)) return;
    if (time === bestTime) {
      if (tier > bestTier) return;
      if (tier === bestTier) {
        if (e < bestEnergy) return;
        if (e === bestEnergy && kind >= bestKind) return; // earlier kinds and indices win
      }
    }
    bestTime = time;
    bestTier = tier;
    bestEnergy = e;
    bestKind = kind;
    bestI = i;
    bestJ = j;
  };

  let truncated = false;
  for (let count = 0; ; count++) {
    bestTime = Infinity;
    bestTier = 99;
    bestEnergy = 0;
    for (let i = 0; i < n; i++) {
      if (transitionAt[i]! < Infinity) {
        offer(transitionAt[i]!, 2, energy(balls[i]!, p), Kind.Transition, i, 0);
      }
    }
    for (let i = 0; i < n; i++) {
      const bi = balls[i]!;
      for (let j = i + 1; j < n; j++) {
        const k = i * n + j;
        let t = ballBall[k]!;
        if (t !== t) {
          const horizon = Math.min(transitionAt[i]!, transitionAt[j]!) - now;
          t = ballBall[k] = now + ballBallTime(bi, balls[j]!, p, horizon);
        }
        if (t <= bestTime) {
          const bj = balls[j]!;
          const dx = bi.vx - bj.vx;
          const dy = bi.vy - bj.vy;
          offer(t, 3, dx * dx + dy * dy, Kind.BallBall, i, j);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const b = balls[i]!;
      if (b.s !== Motion.Sliding && b.s !== Motion.Rolling) continue;
      const horizon = transitionAt[i]! - now;
      for (let c = 0; c < nc; c++) {
        let t = circular[i * nc + c]!;
        if (t !== t)
          t = circular[i * nc + c] = now + circularCushionTime(b, table.circular[c]!, p, horizon);
        if (t <= bestTime) offer(t, 3, energy(b, p), Kind.Circular, i, c);
      }
      for (let c = 0; c < nl; c++) {
        let t = linear[i * nl + c]!;
        if (t !== t)
          t = linear[i * nl + c] = now + linearCushionTime(b, table.linear[c]!, p, horizon);
        if (t <= bestTime) offer(t, 3, energy(b, p), Kind.Linear, i, c);
      }
      for (let c = 0; c < np; c++) {
        let t = pocket[i * np + c]!;
        if (t !== t) t = pocket[i * np + c] = now + pocketTime(b, table.pockets[c]!, p, horizon);
        if (t <= bestTime) offer(t, 2, energy(b, p), Kind.Pocket, i, c);
      }
    }
    if (bestTime === Infinity) break;

    // Move everything to the moment of the event.
    const dt = bestTime - now;
    for (const b of balls) {
      evolve(b, dt, p, b);
      b.t = bestTime;
    }
    now = bestTime;

    const i = bestI;
    const bi = balls[i]!;
    let involved: number[];
    switch (bestKind) {
      case Kind.Transition: {
        const from = bi.s;
        const to = transitionTo[i]! as Motion;
        bi.s = to;
        if (to === Motion.Spinning) bi.vx = bi.vy = bi.vz = bi.wx = bi.wy = 0;
        if (to === Motion.Stationary) bi.vx = bi.vy = bi.vz = bi.wx = bi.wy = bi.wz = 0;
        events.push({ kind: 'transition', t: now, ball: i, from, to });
        involved = [i];
        break;
      }
      case Kind.BallBall: {
        const impact = hitBalls(bi, balls[bestJ]!, p);
        events.push({ kind: 'ball', t: now, a: i, b: bestJ, impact });
        involved = [i, bestJ];
        break;
      }
      case Kind.Linear: {
        const impact = hitLinear(bi, table.linear[bestJ]!, p);
        events.push({ kind: 'cushion', t: now, ball: i, cushion: table.linear[bestJ]!.id, impact });
        involved = [i];
        break;
      }
      case Kind.Circular: {
        const impact = hitCircular(bi, table.circular[bestJ]!, p);
        events.push({ kind: 'jaw', t: now, ball: i, jaw: table.circular[bestJ]!.id, impact });
        involved = [i];
        break;
      }
      case Kind.Pocket: {
        const target = table.pockets[bestJ]!;
        const entry = copyState(bi);
        bi.rx = target.cx;
        bi.ry = target.cy;
        bi.rz = -POCKET_DEPTH;
        bi.vx = bi.vy = bi.vz = bi.wx = bi.wy = bi.wz = 0;
        bi.s = Motion.Pocketed;
        events.push({ kind: 'pocket', t: now, ball: i, pocket: target.id, entry });
        involved = [i];
        break;
      }
    }
    for (const k of involved) {
      updateTransition(k);
      forget(k);
      segments[k]!.push(copyState(balls[k]!));
    }

    if (count >= maxEvents) {
      // pooltool's stop_balls: everything still on the table stops where it is.
      for (let k = 0; k < n; k++) {
        const b = balls[k]!;
        if (b.s === Motion.Pocketed || b.s === Motion.Stationary) continue;
        b.s = Motion.Stationary;
        b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
        segments[k]!.push(copyState(b));
      }
      truncated = true;
      break;
    }
  }

  return { events, segments, final: balls.map(copyState), duration: now, truncated };
}
