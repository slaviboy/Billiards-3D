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

// How far the cue must be raised to pass over everything behind the cue ball: the cloth, the
// cushions and the rail it reaches over, and any ball near its line. The game draws the cue, and
// strikes the shot, at least this high (App.elevation), so a cue never goes through the table or a
// ball, as a real one cannot.
//
// In the table's frame (x across, y along, z up from the cloth). The cue is a round solid along its
// axis, thin at the tip and thick at the butt (CUE_PARTS). Each obstacle is a point the axis must
// pass above, with the cue's radius there between them. A point at horizontal distance t behind
// the tip and height k above it is cleared at elevation θ when t·sin θ − k·cos θ ≥ ρ, that is when
// θ ≥ atan2(k, t) + asin(ρ / √(t² + k²)).

import { BALL_RADIUS, type TableSpec } from '../table/spec.ts';
import { CUE_LENGTH, CUE_PARTS } from './spec.ts';

const R = BALL_RADIUS;
/** Room left between the cue and anything it passes over, metres. */
const MARGIN = 0.0015;
/** How far the stroke draws the cue back at most (App.updateCue), metres. */
const MAX_DRAW = 0.25;
/** Spacing of the points along the cue's path that are checked, metres. */
const STEP = 0.005;
/** The pocket leathers stand a little proud of the rail cap, and the side pockets' stand out past
 * its edge (blender/scripts/table.py). */
const LEATHER = 0.0015;
const LEATHER_OUT = 0.04;

/** The cue's outline: (distance from the tip, radius), from the tip to the butt. */
const OUTLINE: readonly (readonly [number, number])[] = (() => {
  const points = CUE_PARTS.flatMap((part) => part.profile.filter(([, r]) => r > 0));
  return [...points].sort((p, q) => p[0] - q[0]);
})();

/** The cue's radius at a distance s from its tip (the butt's beyond it). */
export function cueRadius(s: number): number {
  if (s <= OUTLINE[0]![0]) return OUTLINE[0]![1];
  for (let i = 1; i < OUTLINE.length; i++) {
    const [s1, r1] = OUTLINE[i]!;
    if (s <= s1) {
      const [s0, r0] = OUTLINE[i - 1]!;
      return s1 > s0 ? r0 + ((r1 - r0) * (s - s0)) / (s1 - s0) : Math.max(r0, r1);
    }
  }
  return OUTLINE[OUTLINE.length - 1]![1];
}

/**
 * Height of the table's top at (x, y): the cloth inside the cushion noses, the cushion's top, the
 * rail cap out to its edge (and as far as the side pockets' leathers stand out past it), and
 * nothing beyond (−∞). Rails and leathers are taken as running all round the table, which is never
 * lower than the table really is.
 */
export function tableHeight(spec: TableSpec, x: number, y: number): number {
  const u = Math.max(-x, x - spec.W, -y, y - spec.L);
  if (u <= 0) return 0;
  if (u > spec.railWidth + LEATHER_OUT) return -Infinity;
  if (u >= spec.cushionWidth) return spec.railHeight + LEATHER;
  const top = cushionTop(spec);
  for (let i = 1; i < top.length; i++) {
    const [d1, h1] = top[i]!;
    if (u <= d1) {
      const [d0, h0] = top[i - 1]!;
      return h0 + ((h1 - h0) * (u - d0)) / (d1 - d0);
    }
  }
  return spec.railHeight + LEATHER;
}

/** The cushion profile's top, from the nose to the featherstrip. */
function cushionTop(spec: TableSpec): readonly (readonly [number, number])[] {
  const profile = spec.cushionProfile;
  const end = profile.findIndex(([d]) => d >= spec.cushionWidth);
  return profile.slice(0, end + 1);
}

/** Where the cue meets the cue ball, and which way it points. */
export interface CueLine {
  /** The cue ball's centre on the table. */
  readonly x: number;
  readonly y: number;
  /** Aim heading on the table, radians (0 along +x, counter-clockwise). */
  readonly heading: number;
  /** Tip offset from the ball's centre in units of R: a to the shooter's left, b up. */
  readonly a: number;
  readonly b: number;
}

interface Obstacle {
  /** Horizontal distance behind the tip, and height above it. */
  readonly t: number;
  readonly k: number;
  /** Distance to the side of the cue's line. */
  readonly e: number;
  /** Whether the point is a ball's centre (else a point of the table's top). */
  readonly ball: boolean;
}

/** The room needed between the cue's axis and an obstacle, where the cue's radius is `radius`. */
function room(o: Obstacle, radius: number): number {
  const touch = o.ball ? R + radius + MARGIN : radius;
  if (Math.abs(o.e) >= touch) return 0;
  return Math.sqrt(touch * touch - o.e * o.e) + (o.ball ? 0 : MARGIN);
}

/**
 * The least elevation, in radians, at which the cue passes over the table and the other balls
 * (positions on the table), at most `max`. Zero when a level cue is clear.
 */
export function minimumElevation(
  spec: TableSpec,
  cue: CueLine,
  balls: readonly { readonly x: number; readonly y: number }[],
  max: number,
): number {
  const dx = Math.cos(cue.heading);
  const dy = Math.sin(cue.heading);
  // Left of the aim, seen from above.
  const lx = -dy;
  const ly = dx;
  const across = cue.a * R;
  const up = cue.b * R;
  const reach = Math.sqrt(Math.max(0, R * R - across * across - up * up));
  // The tip's contact point on the cue ball.
  const px = cue.x + lx * across - dx * reach;
  const py = cue.y + ly * across - dy * reach;
  const pz = R + up;

  const obstacles: Obstacle[] = [];
  const far = CUE_LENGTH + MAX_DRAW;
  // The table under the cue, along its axis and on either side of it as far as its widest.
  const widest = cueRadius(CUE_LENGTH);
  for (const f of [0, -0.25, 0.25, -0.5, 0.5, -0.75, 0.75, -0.9, 0.9, -1, 1]) {
    const e = f * widest;
    const ox = px + lx * e;
    const oy = py + ly * e;
    for (const t of pathPoints(spec, ox, oy, dx, dy, far)) {
      const h = tableHeight(spec, ox - dx * t, oy - dy * t);
      if (h !== -Infinity) obstacles.push({ t, k: h - pz, e, ball: false });
    }
  }
  // The other balls behind the tip, near enough to the cue's line to touch it.
  for (const ball of balls) {
    const vx = ball.x - px;
    const vy = ball.y - py;
    const t = -(vx * dx + vy * dy);
    const e = vx * lx + vy * ly;
    if (t <= 0 || t > far) continue;
    obstacles.push({ t, k: R - pz, e, ball: true });
  }

  // The cue thickens toward the butt, and a steeper cue meets each point further from its tip, so
  // each pass can only raise the answer; a few passes settle it.
  let theta = 0;
  for (let pass = 0; pass < 6; pass++) {
    const reachOut = far * Math.cos(theta);
    let need = 0;
    for (const o of obstacles) {
      if (o.t > reachOut) continue;
      const needed = room(o, cueRadius(o.t / Math.cos(theta)));
      if (needed <= 0) continue;
      const distance = Math.hypot(o.t, o.k);
      const angle =
        needed >= distance ? Math.PI / 2 : Math.atan2(o.k, o.t) + Math.asin(needed / distance);
      need = Math.max(need, angle);
    }
    need = Math.min(need, max);
    if (need <= theta + 1e-9) break;
    theta = need;
  }
  return theta;
}

/**
 * Distances behind (ox, oy), along −(dx, dy), at which the table's height is checked: evenly
 * spaced, and on both sides of every edge the path crosses (cushion noses, featherstrips, the rail
 * caps' outer edges), where the heights step.
 */
function pathPoints(
  spec: TableSpec,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  far: number,
): number[] {
  const out: number[] = [];
  for (let t = 0; t <= far; t += STEP) out.push(t);
  const { W, L, cushionWidth: cw, railWidth: rw } = spec;
  const edges = (o: number, d: number, size: number) => {
    if (Math.abs(d) < 1e-12) return;
    for (const line of [-rw, -cw, 0, size, size + cw, size + rw]) {
      const t = (o - line) / d;
      if (t > 0 && t <= far) out.push(Math.max(0, t - 1e-7), t + 1e-7);
    }
  };
  edges(ox, dx, W);
  edges(oy, dy, L);
  return out;
}
