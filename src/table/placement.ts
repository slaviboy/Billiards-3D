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

// Where a ball may be put by hand: the cue ball in hand (WPA 1.6), restricted to above the head
// string after some fouls on the break (3.10), and the 8 when it is spotted (1.5). Both players
// check placements with the same arithmetic.

import { Motion, MIN_DIST, type BallState } from '../physics/state.ts';
import type { TableGeometry } from './geometry.ts';
import { BALL_RADIUS } from './spec.ts';

const R = BALL_RADIUS;
/** Clearance kept from the cushions and from other balls when placing a ball. */
export const PLACEMENT_GAP = 10 * MIN_DIST;
/** The spotted 8 keeps this far from the cue ball (WPA 1.5: "a small separation"). */
const CUE_BALL_SEPARATION = 0.001;

export type Placement = 'table' | 'kitchen';

/** Whether ball `index` may be put at (x, y) with the other balls where they are. */
export function canPlace(
  table: TableGeometry,
  balls: readonly Readonly<BallState>[],
  index: number,
  x: number,
  y: number,
  where: Placement,
): boolean {
  const { W, L } = table.spec;
  const margin = R + PLACEMENT_GAP;
  if (!(x >= margin && x <= W - margin && y >= margin && y <= L - margin)) return false;
  // "Above the head string": between the head rail and the string, not on it.
  if (where === 'kitchen' && !(y < table.headString)) return false;
  const min = 2 * R + PLACEMENT_GAP;
  for (let i = 0; i < balls.length; i++) {
    if (i === index) continue;
    const b = balls[i]!;
    if (b.s === Motion.Pocketed) continue;
    const dx = b.rx - x;
    const dy = b.ry - y;
    if (dx * dx + dy * dy < min * min) return false;
  }
  return true;
}

/**
 * Where a spotted ball goes (WPA 1.5): on the long string as close as possible to the foot spot,
 * between the foot spot and the foot rail; in contact with the ball in the way if the spot is taken
 * (but not touching the cue ball); above the foot spot only if the whole string below it is blocked.
 */
export function spotPosition(
  table: TableGeometry,
  balls: readonly Readonly<BallState>[],
  index: number,
): { x: number; y: number } {
  const x = table.footSpot.x;
  // Ball 0 is the cue ball.
  const clearance = (i: number) => 2 * R + (i === 0 ? CUE_BALL_SEPARATION : PLACEMENT_GAP);
  const free = (y: number) =>
    y >= R + PLACEMENT_GAP &&
    y <= table.spec.L - R - PLACEMENT_GAP &&
    balls.every((b, i) => {
      if (i === index || b.s === Motion.Pocketed) return true;
      const dx = b.rx - x;
      const dy = b.ry - y;
      const c = clearance(i);
      return dx * dx + dy * dy >= c * c;
    });
  // Candidates: the spot itself, and just touching each ball near the string, on either side.
  const candidates = [table.footSpot.y];
  balls.forEach((b, i) => {
    if (i === index || b.s === Motion.Pocketed) return;
    const dx = b.rx - x;
    const c = clearance(i) * (1 + 1e-12);
    if (Math.abs(dx) >= c) return;
    const dy = Math.sqrt(c * c - dx * dx);
    candidates.push(b.ry + dy, b.ry - dy);
  });
  const below = candidates.filter((y) => y >= table.footSpot.y && free(y)).sort((a, b) => a - b);
  if (below.length) return { x, y: below[0]! };
  const above = candidates.filter((y) => y < table.footSpot.y && free(y)).sort((a, b) => b - a);
  if (above.length) return { x, y: above[0]! };
  return { x, y: table.footSpot.y };
}
