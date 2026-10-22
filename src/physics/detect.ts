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
 * Translated and changed from pooltool (pooltool/evolution/event_based/solve.py),
 * Apache License 2.0; see NOTICE.md.
 */

// When will a ball next touch another ball, a cushion, a lip or a pocket? Each ball's path until
// its next change of motion is r(t) = c + b·t + a·t², so each question is a polynomial in t:
//
//   two balls      |Δr(t)|² − (2R)²            quartic
//   a lip circle   |r(t) − centre|² − (r + R)²  quartic
//   a pocket       |r(t) − centre|² − r²        quartic (the centre enters the slate cut)
//   a cushion      n·(r(t) − p₁) − R            quadratic, then the contact must fall on the segment
//
// Each returns the time from now until contact, or Infinity if none before `horizon` (the first
// of the balls' next transitions, after which their paths are different polynomials anyway).
// Unlike pooltool, which finds every root, only the first closing of a gap is searched for, and a
// quick bound skips pairs too far apart to meet in time.

import { trajectory } from './motion.ts';
import { firstFall } from './roots.ts';
import type { CircularCushion, LinearCushion, Pocket } from './types.ts';
import { type BallParams, type BallState, Motion } from './state.ts';

const A = new Float64Array(6);
const B = new Float64Array(6);
const quartic = [0, 0, 0, 0, 0];
const quadratic = [0, 0, 0];

const translating = (s: Motion) => s === Motion.Sliding || s === Motion.Rolling;

export function ballBallTime(
  b1: Readonly<BallState>,
  b2: Readonly<BallState>,
  p: BallParams,
  horizon: number,
): number {
  if (b1.s === Motion.Pocketed || b2.s === Motion.Pocketed) return Infinity;
  if (!translating(b1.s) && !translating(b2.s)) return Infinity;
  const cx = b2.rx - b1.rx;
  const cy = b2.ry - b1.ry;
  const contact = 2 * p.R;
  const d2 = cx * cx + cy * cy;
  if (d2 < contact * contact) return 0; // overlapping: resolve at once, as pooltool does
  trajectory(b1, p, A);
  trajectory(b2, p, B);
  const ax = B[0]! - A[0]!;
  const ay = B[1]! - A[1]!;
  const bx = B[2]! - A[2]!;
  const by = B[3]! - A[3]!;
  if (!reachable(Math.sqrt(d2) - contact, ax, ay, bx, by, horizon)) return Infinity;
  quartic[0] = ax * ax + ay * ay;
  quartic[1] = 2 * (ax * bx + ay * by);
  quartic[2] = bx * bx + by * by + 2 * (ax * cx + ay * cy);
  quartic[3] = 2 * (bx * cx + by * cy);
  quartic[4] = d2 - contact * contact;
  return firstFall(quartic, horizon);
}

export function linearCushionTime(
  b: Readonly<BallState>,
  c: LinearCushion,
  p: BallParams,
  horizon: number,
): number {
  if (!translating(b.s)) return Infinity;
  trajectory(b, p, A);
  const na = c.nx * A[0]! + c.ny * A[1]!;
  const nb = c.nx * A[2]! + c.ny * A[3]!;
  const gap = c.nx * (b.rx - c.p1x) + c.ny * (b.ry - c.p1y) - p.R;
  if (gap > 0 && !reachable(gap, A[0]!, A[1]!, A[2]!, A[3]!, horizon)) return Infinity;
  let t: number;
  if (gap <= 0 && nb < 0)
    t = 0; // already touching and moving in
  else {
    quadratic[0] = na;
    quadratic[1] = nb;
    quadratic[2] = gap;
    t = firstFall(quadratic, horizon);
    if (t === Infinity) return t;
  }
  // The contact must fall on the segment, not on its line beyond the ends.
  const x = b.rx + (A[2]! + A[0]! * t) * t;
  const y = b.ry + (A[3]! + A[1]! * t) * t;
  const ux = c.p2x - c.p1x;
  const uy = c.p2y - c.p1y;
  const s = ((x - c.p1x) * ux + (y - c.p1y) * uy) / (ux * ux + uy * uy);
  return s >= 0 && s <= 1 ? t : Infinity;
}

export function circularCushionTime(
  b: Readonly<BallState>,
  c: CircularCushion,
  p: BallParams,
  horizon: number,
): number {
  return circleTime(b, c.cx, c.cy, c.r + p.R, p, horizon, false);
}

export function pocketTime(
  b: Readonly<BallState>,
  pocket: Pocket,
  p: BallParams,
  horizon: number,
): number {
  return circleTime(b, pocket.cx, pocket.cy, pocket.r, p, horizon, true);
}

/** When the ball's centre first comes within `radius` of (x0, y0). */
function circleTime(
  b: Readonly<BallState>,
  x0: number,
  y0: number,
  radius: number,
  p: BallParams,
  horizon: number,
  inside: boolean,
): number {
  if (!translating(b.s)) return Infinity;
  const cx = b.rx - x0;
  const cy = b.ry - y0;
  const d2 = cx * cx + cy * cy;
  trajectory(b, p, A);
  const ax = A[0]!;
  const ay = A[1]!;
  const bx = A[2]!;
  const by = A[3]!;
  const c0 = d2 - radius * radius;
  // Already within: a pocket takes the ball at once; a lip only if the ball is moving in.
  if (c0 <= 0 && (inside || bx * cx + by * cy < 0)) return 0;
  if (c0 > 0 && !reachable(Math.sqrt(d2) - radius, ax, ay, bx, by, horizon)) return Infinity;
  quartic[0] = ax * ax + ay * ay;
  quartic[1] = 2 * (ax * bx + ay * by);
  quartic[2] = bx * bx + by * by + 2 * (ax * cx + ay * cy);
  quartic[3] = 2 * (bx * cx + by * cy);
  quartic[4] = c0;
  return firstFall(quartic, horizon);
}

/** Whether a gap can close within the horizon, moving at most |b|·t + |a|·t². */
function reachable(gap: number, ax: number, ay: number, bx: number, by: number, horizon: number) {
  if (!(horizon < Infinity)) return true;
  const reach =
    Math.sqrt(bx * bx + by * by) * horizon + Math.sqrt(ax * ax + ay * ay) * horizon * horizon;
  // A margin for rounding: the bound only ever skips pairs that clearly cannot meet.
  return gap <= reach * (1 + 1e-9) + 1e-12;
}
