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

// How far balls run on the 9-foot table, against published figures rather than against pooltool:
//
// - D. G. Alciatore, technical proof TP B.6, "CB table lengths of travel for different speeds,
//   accounting for rail rebound and drag losses" (revised 2023-12-03): a rolling ball with
//   rolling resistance 0.01, sent from one end of a 100-inch table, travels 0.903 table lengths
//   at 1.5 mph, 1.684 at 3, 2 at 3.465 (a lag), 3.005 at 7, 3.69 at 12 and 4.715 at 20. His model
//   is deliberately simple: every rail rebound kills the spin (stun) at a coefficient of 0.7,
//   and he notes that a real ball usually leaves the rail with some roll, so it keeps more speed.
//   Ours may run somewhat further, never shorter.
// - The WPA table specification: a centre-ball shot with a level cue and a firm stroke from the
//   head spot through the foot spot travels 4 to 4½ table lengths. "Firm" is not a number; we read
//   it as a cue ball leaving at 14–16 mph, between Dr. Dave's fast (12) and power (20) speeds.

import { describe, expect, it } from 'vitest';
import { encodeShot, decodeShot } from '../../../src/game/shotCodec.ts';
import {
  ballState,
  Motion,
  POOL_BALL,
  sampleInto,
  simulate,
  type Strike,
} from '../../../src/physics/index.ts';
import type { BallState } from '../../../src/physics/state.ts';
import { buildTable } from '../../../src/table/geometry.ts';
import { BALL_RADIUS as R, tableSpec } from '../../../src/table/spec.ts';

const MPH = 0.44704;
const table = buildTable(tableSpec('9ft'));
const L = table.spec.L;

/** How many table lengths a lone ball runs before it stops. */
function tableLengths(start: BallState, strike: Strike | null): number {
  const timeline = simulate([start], strike, table.physics);
  const s = ballState(0, 0, 0);
  let path = 0;
  let [x, y] = [start.rx, start.ry];
  for (let t = 0.001; t <= timeline.duration; t += 0.001) {
    sampleInto(timeline, 0, t, s, POOL_BALL);
    path += Math.hypot(s.rx - x, s.ry - y);
    [x, y] = [s.rx, s.ry];
  }
  return path / L;
}

/** A ball rolling up the middle of the table from the head rail's cushion. */
const rolling = (mph: number): BallState => {
  const v = mph * MPH;
  return { ...ballState(table.spec.W / 2, R, R), vy: v, wx: -v / R, s: Motion.Rolling };
};

describe('the speed of the table', () => {
  const TP_B6: [string, number, number][] = [
    ['touch', 1.5, 0.903],
    ['slow', 3, 1.684],
    ['lag', 3.465, 2],
    ['medium', 7, 3.005],
    ['fast', 12, 3.69],
    ['power', 20, 4.715],
  ];

  for (const [name, mph, lengths] of TP_B6) {
    it(`runs a ${name} roll (${mph} mph) about as far as Dr. Dave's estimate of ${lengths} lengths`, () => {
      const ours = tableLengths(rolling(mph), null);
      expect(ours / lengths).toBeGreaterThan(0.95);
      expect(ours / lengths).toBeLessThan(1.25);
    });
  }

  it('sends a lag up the table and back to the head rail at about 3.5 mph', () => {
    expect(tableLengths(rolling(3.465), null)).toBeCloseTo(2, 0);
  });

  it('meets the WPA speed test: a firm centre-ball shot travels 4 to 4½ table lengths', () => {
    const strike = (mph: number) => {
      // The cue speed that sends the cue ball off at this speed (centre ball, level cue).
      const probe = decodeShot(encodeShot(Math.PI / 2, 0, 1, 0, 0));
      const start = ballState(table.headSpot.x, table.headSpot.y, R);
      const first = simulate([start], probe, table.physics).segments[0]!.find((s) => s.vy > 0)!;
      const perCue = Math.hypot(first.vx, first.vy);
      return decodeShot(encodeShot(Math.PI / 2, 0, (mph * MPH) / perCue, 0, 0));
    };
    for (const mph of [14, 16]) {
      const lengths = tableLengths(ballState(table.headSpot.x, table.headSpot.y, R), strike(mph));
      expect(lengths).toBeGreaterThanOrEqual(4);
      expect(lengths).toBeLessThanOrEqual(4.5);
    }
  });
});
