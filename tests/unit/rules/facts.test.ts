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

// The rack, placements, spotting, the shot codec and the facts the rules read, on real simulated
// shots.

import { describe, expect, it } from 'vitest';
import { ballState, Motion, simulate } from '../../../src/physics/index.ts';
import { shotFacts } from '../../../src/rules/facts.ts';
import { judge, newRack } from '../../../src/rules/eightBall.ts';
import { buildTable } from '../../../src/table/geometry.ts';
import { canPlace, spotPosition } from '../../../src/table/placement.ts';
import { breakSpot, rackBalls, seedFrom } from '../../../src/table/rack.ts';
import { BALL_RADIUS as R, tableSpec } from '../../../src/table/spec.ts';
import {
  decodePlacement,
  decodeShot,
  encodePlacement,
  encodeShot,
  isShotCode,
} from '../../../src/game/shotCodec.ts';

const table = buildTable(tableSpec('9ft'));
const { W, L } = table.spec;

describe('the rack (WPA 4.2)', () => {
  const balls = rackBalls(table, seedFrom('a shared seed'));
  const row = (n: number) =>
    Math.round((balls[n]!.ry - table.footSpot.y) / ((2 * R * Math.sqrt(3)) / 2));

  it('has the cue ball above the head string and fifteen balls in a triangle from the foot spot', () => {
    expect(balls).toHaveLength(16);
    expect(balls[0]!.ry).toBeLessThan(table.headString);
    const apex = balls.slice(1).find((b) => Math.abs(b.ry - table.footSpot.y) < 1e-4)!;
    expect(apex.rx).toBeCloseTo(table.footSpot.x, 4);
    for (let i = 1; i < 16; i++) {
      for (let j = i + 1; j < 16; j++) {
        const d = Math.hypot(balls[i]!.rx - balls[j]!.rx, balls[i]!.ry - balls[j]!.ry);
        expect(d).toBeGreaterThan(2 * R);
      }
    }
  });

  it('puts the 8 in the middle of the third row and a solid and a stripe in the back corners', () => {
    expect(row(8)).toBe(2);
    expect(balls[8]!.rx).toBeCloseTo(table.footSpot.x, 4);
    const back = [];
    for (let n = 1; n <= 15; n++) {
      if (row(n) === 4 && Math.abs(balls[n]!.rx - table.footSpot.x) > 3 * R) back.push(n);
    }
    expect(back).toHaveLength(2);
    expect(back.filter((n) => n < 8)).toHaveLength(1);
  });

  it('is the same for the same seed and different for another', () => {
    const again = rackBalls(table, seedFrom('a shared seed'));
    const other = rackBalls(table, seedFrom('another seed'));
    expect(again).toEqual(balls);
    expect(other).not.toEqual(balls);
  });
});

describe('placing the cue ball', () => {
  const balls = rackBalls(table, 1);

  it('allows the cue ball anywhere clear on the cloth', () => {
    expect(canPlace(table, balls, 0, W / 2, L / 2, 'table')).toBe(true);
    expect(canPlace(table, balls, 0, R / 2, L / 2, 'table')).toBe(false); // in the cushion
    expect(canPlace(table, balls, 0, balls[5]!.rx, balls[5]!.ry + R, 'table')).toBe(false); // on a ball
  });

  it('keeps it above the head string when the rules say so, not on the string', () => {
    expect(canPlace(table, balls, 0, W / 2, table.headString - 0.01, 'kitchen')).toBe(true);
    expect(canPlace(table, balls, 0, W / 2, table.headString, 'kitchen')).toBe(false);
    expect(canPlace(table, balls, 0, W / 2, table.headString + 0.3, 'kitchen')).toBe(false);
  });
});

describe('spotting the 8 (WPA 1.5)', () => {
  it('goes on the foot spot when it is free', () => {
    const balls = [
      ballState(W / 2, 0.3, R),
      ...Array.from({ length: 15 }, () => ballState(0, 0, R, Motion.Pocketed)),
    ];
    expect(spotPosition(table, balls, 8)).toEqual({ x: W / 2, y: table.footSpot.y });
  });

  it('goes behind a ball on the spot, touching it, between the spot and the foot rail', () => {
    const balls = [
      ballState(W / 2, 0.3, R),
      ballState(W / 2 + 0.01, table.footSpot.y, R),
      ...Array.from({ length: 14 }, () => ballState(0, 0, R, Motion.Pocketed)),
    ];
    const at = spotPosition(table, balls, 8);
    expect(at.x).toBe(W / 2);
    expect(at.y).toBeGreaterThan(table.footSpot.y);
    expect(Math.hypot(at.x - balls[1]!.rx, at.y - balls[1]!.ry)).toBeCloseTo(2 * R, 4);
  });
});

describe('the shot codec', () => {
  it('round-trips a shot within its resolution and decodes the same bits every time', () => {
    const code = encodeShot(1.2345, 7.3, 3.217, 0.2, -0.35);
    expect(isShotCode(code)).toBe(true);
    expect(code).toEqual({
      yaw: Math.round((1.2345 / (2 * Math.PI)) * (1 << 20)),
      pitch: 73,
      speed: 3217,
      a: 200,
      b: -350,
    });
    const strike = decodeShot(code);
    expect(Math.atan2(strike.sinPhi, strike.cosPhi)).toBeCloseTo(1.2345, 5);
    expect(decodeShot(code)).toEqual(strike);
  });

  it('clamps the tip to the miscue limit and rejects anything out of range', () => {
    const code = encodeShot(0, 0, 1, 0.6, 0.6);
    expect(code.a * code.a + code.b * code.b).toBeLessThanOrEqual(500 * 500);
    expect(isShotCode({ ...code, speed: 9000 })).toBe(false);
    expect(isShotCode({ ...code, yaw: 1.5 })).toBe(false);
    expect(isShotCode({ yaw: 0, pitch: 0, speed: 100, a: 400, b: 400 })).toBe(false);
    expect(isShotCode(null)).toBe(false);
  });

  it('round-trips a placement to 10 µm', () => {
    const p = decodePlacement(encodePlacement(0.4321234, 0.5432123));
    expect(p.x).toBeCloseTo(0.4321234, 5);
    expect(p.y).toBeCloseTo(0.5432123, 5);
  });
});

describe('facts from real shots', () => {
  const run = (balls: ReturnType<typeof ballState>[], heading: number, speed: number) => {
    const timeline = simulate(
      balls,
      decodeShot(encodeShot(heading, 0, speed, 0, 0)),
      table.physics,
    );
    return { timeline, facts: shotFacts(timeline, balls, table.headString) };
  };

  it('records the first ball hit, a rail after it, and the pocketed balls', () => {
    // Straight at a ball in front of the side pocket's line... simply into the 1 near a corner.
    const balls = [ballState(0.25, 0.25, R), ballState(0.1, 0.1, R)];
    const { facts } = run(balls, (225 * Math.PI) / 180, 1.5);
    expect(facts.firstContact).toBe(1);
    expect(facts.pocketed.map((p) => p.ball)).toContain(1);
    expect(facts.railAfterContact).toBe(true);
  });

  it('knows whether the cue ball crossed the head string before its first contact', () => {
    const near = [ballState(W / 2, 0.3, R), ballState(W / 2, table.headString - 0.2, R)];
    const blocked = run(near, Math.PI / 2, 0.8).facts;
    // The ball in the way is above the head string, so the cue ball never reaches it first.
    expect(blocked.crossedHeadString).toBe(false);
    expect(blocked.firstContactBelowHeadString).toBe(false);
    const far = [ballState(W / 2, 0.3, R), ballState(W / 2, table.headString + 0.4, R)];
    expect(run(far, Math.PI / 2, 1.5).facts.crossedHeadString).toBe(true);
  });

  it('judges a real break on a real rack', () => {
    const balls = rackBalls(table, seedFrom('break'));
    const start = breakSpot(table);
    const heading = Math.atan2(table.footSpot.y - start.y, table.footSpot.x - start.x);
    const timeline = simulate(balls, decodeShot(encodeShot(heading, 0, 7, 0, -0.1)), table.physics);
    const f = shotFacts(timeline, balls, table.headString);
    expect(f.firstContact).not.toBeNull();
    expect(f.ballsToRail).toBeGreaterThanOrEqual(4);
    const { ruling } = judge(
      newRack(0),
      f,
      { pocket: null, safety: false },
      balls.map(() => true),
    );
    expect(ruling.legalBreak).toBe(true);
  });
});
