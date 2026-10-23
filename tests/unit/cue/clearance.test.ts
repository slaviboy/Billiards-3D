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

// The cue at its least elevation passes over the table and the balls, and only just: checked
// against the cue as a chain of balls along its axis, each as wide as the cue is there.

import { describe, expect, it } from 'vitest';
import {
  cueRadius,
  type CueLine,
  minimumElevation,
  tableHeight,
} from '../../../src/cue/clearance.ts';
import { CUE_LENGTH, TIP_RADIUS } from '../../../src/cue/spec.ts';
import { BALL_RADIUS, TABLE_SIZES, tableSpec, type TableSpec } from '../../../src/table/spec.ts';

const R = BALL_RADIUS;
const MAX = (60 * Math.PI) / 180;
const DEG = Math.PI / 180;

type Ball = { x: number; y: number };

/**
 * How deep the cue at elevation θ, drawn back by `draw`, cuts into the table or a ball (metres;
 * zero or less when clear).
 */
function overlap(spec: TableSpec, cue: CueLine, balls: Ball[], theta: number, draw = 0): number {
  const dx = Math.cos(cue.heading);
  const dy = Math.sin(cue.heading);
  const lx = -dy;
  const ly = dx;
  const across = cue.a * R;
  const up = cue.b * R;
  const reach = Math.sqrt(R * R - across * across - up * up);
  const px = cue.x + lx * across - dx * reach;
  const py = cue.y + ly * across - dy * reach;
  const pz = R + up;
  let worst = -Infinity;
  for (let s = 0.003; s <= CUE_LENGTH; s += 0.002) {
    const along = s + draw;
    const cx = px - dx * along * Math.cos(theta);
    const cy = py - dy * along * Math.cos(theta);
    const cz = pz + along * Math.sin(theta);
    const r = cueRadius(s);
    for (const ball of balls) {
      const d = Math.hypot(cx - ball.x, cy - ball.y, cz - R);
      worst = Math.max(worst, R + r - d);
    }
    // The table under this ball of the cue, across its width.
    for (let i = -4; i <= 4; i++) {
      for (let j = -4; j <= 4; j++) {
        const ox = (i / 4) * r;
        const oy = (j / 4) * r;
        const o2 = ox * ox + oy * oy;
        if (o2 > r * r) continue;
        const bottom = cz - Math.sqrt(r * r - o2);
        worst = Math.max(worst, tableHeight(spec, cx + ox, cy + oy) - bottom);
      }
    }
  }
  return worst;
}

describe.each(TABLE_SIZES)('the cue over the %s table', (size) => {
  const spec = tableSpec(size);
  const { W, L } = spec;

  it('stays level over open cloth', () => {
    // Near the foot rail, aimed at it: the whole cue, drawn back, lies over the cloth.
    const cue = { x: W / 2, y: L - 0.12, heading: Math.PI / 2, a: 0, b: 0 };
    expect(minimumElevation(spec, cue, [], MAX)).toBe(0);
    expect(overlap(spec, cue, [], 0)).toBeLessThan(0);
  });

  it('rises just enough to pass over the rail behind the cue ball', () => {
    for (const [x, y, heading] of [
      [W / 2, 0.5, Math.PI / 2],
      [0.2, L / 2, 0.3],
      [W - 0.1, 0.3, 2.2],
      [W / 2, L - 0.15, -Math.PI / 2],
      [0.4, 0.4, Math.PI / 4],
    ] as const) {
      for (const [a, b] of [
        [0, 0],
        [0.4, -0.3],
        [-0.3, 0.45],
      ] as const) {
        const cue = { x, y, heading, a, b };
        const theta = minimumElevation(spec, cue, [], MAX);
        expect(theta).toBeGreaterThan(0);
        expect(overlap(spec, cue, [], theta), `${x} ${y} ${heading}`).toBeLessThan(2e-4);
        expect(overlap(spec, cue, [], theta, 0.232)).toBeLessThan(2e-4);
        // And no lower: a degree less would cut into the rail.
        expect(overlap(spec, cue, [], Math.max(0, theta - DEG))).toBeGreaterThan(0);
      }
    }
  });

  it('passes over a ball behind the cue ball, and ignores one off to the side', () => {
    const cue = { x: W / 2, y: L - 0.12, heading: Math.PI / 2, a: 0, b: 0 };
    const behind = [{ x: W / 2 + 0.01, y: L - 0.24 }];
    const theta = minimumElevation(spec, cue, behind, MAX);
    expect(theta).toBeGreaterThan(10 * DEG);
    expect(overlap(spec, cue, behind, theta)).toBeLessThan(2e-4);
    // The margin left above a ball this near is worth most of a degree.
    expect(overlap(spec, cue, behind, theta - 1.5 * DEG)).toBeGreaterThan(0);
    const aside = [{ x: W / 2 + 0.1, y: L - 0.24 }];
    expect(minimumElevation(spec, cue, aside, MAX)).toBe(0);
    // A ball in front of the cue ball is no obstacle.
    expect(minimumElevation(spec, cue, [{ x: W / 2, y: L - 0.05 }], MAX)).toBe(0);
  });

  it('stops at the highest elevation allowed when nothing lower clears', () => {
    // Frozen to the head cushion, aimed away from it, struck low: the nose overhangs the tip.
    const cue = { x: W / 2, y: R, heading: Math.PI / 2, a: 0, b: -0.4 };
    expect(minimumElevation(spec, cue, [], MAX)).toBe(MAX);
  });
});

describe('the table and cue outlines', () => {
  const spec = tableSpec('9ft');

  it('reads the table as cloth, cushion, rail cap and nothing beyond', () => {
    expect(tableHeight(spec, spec.W / 2, spec.L / 2)).toBe(0);
    expect(tableHeight(spec, -1e-9, 1)).toBeCloseTo(spec.noseHeight, 6);
    expect(tableHeight(spec, -spec.cushionWidth - 0.01, 1)).toBeGreaterThanOrEqual(spec.railHeight);
    // The side pockets' leathers stand up to 4 cm out past the rail's edge.
    expect(tableHeight(spec, -spec.railWidth - 0.03, 1)).toBeGreaterThanOrEqual(spec.railHeight);
    expect(tableHeight(spec, -spec.railWidth - 0.041, 1)).toBe(-Infinity);
  });

  it('widens the cue from the tip to the butt cap', () => {
    expect(cueRadius(0.01)).toBeCloseTo(TIP_RADIUS, 4);
    let last = 0;
    // The rubber bumper past the butt cap narrows again.
    for (let s = 0.01; s <= CUE_LENGTH - 0.01; s += 0.01) {
      const r = cueRadius(s);
      expect(r).toBeGreaterThanOrEqual(last - 0.0003);
      last = Math.max(last, r);
    }
    expect(last).toBeGreaterThan(0.015);
  });
});
