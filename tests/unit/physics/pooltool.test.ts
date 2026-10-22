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

// The translation against the original: each scenario in tests/fixtures/pooltool/scenarios.json
// was simulated by pooltool 0.6.0 itself (tools/pooltool-fixtures/generate.py), on this exact table.
// The same shots here must produce the same events in the same order, at the same times, and leave
// the balls in the same places.

import { describe, expect, it } from 'vitest';
import { ballState, simulate, type Motion, type PhysicsEvent } from '../../../src/physics/index.ts';
import { buildTable } from '../../../src/table/geometry.ts';
import { type TableSize, tableSpec } from '../../../src/table/spec.ts';
import scenarios from '../../fixtures/pooltool/scenarios.json' with { type: 'json' };
import results from '../../fixtures/pooltool/results.json' with { type: 'json' };

interface Scenario {
  readonly size: TableSize;
  readonly balls: readonly {
    readonly x: number;
    readonly y: number;
    readonly v?: readonly number[];
    readonly w?: readonly number[];
    readonly s?: number;
  }[];
  readonly cue: {
    readonly ball: number;
    readonly V0: number;
    readonly phi: number;
    readonly theta: number;
    readonly a: number;
    readonly b: number;
  } | null;
}

interface Result {
  readonly events: readonly { readonly type: string; readonly t: number; readonly ids: string[] }[];
  readonly final: Record<string, { readonly r: number[]; readonly s: number }>;
}

const R = 0.028575;
const TRANSITIONS: Record<string, string> = {
  '2-3': 'sliding_rolling',
  '3-1': 'rolling_spinning',
  '3-0': 'rolling_stationary',
  '1-0': 'spinning_stationary',
};

/** An event in pooltool's terms: its type and the ids of what took part. */
function asPooltool(e: PhysicsEvent): string {
  switch (e.kind) {
    case 'stick':
      return `stick_ball:cue,${e.ball}`;
    case 'ball':
      return `ball_ball:${e.a},${e.b}`;
    case 'cushion':
      return `ball_linear_cushion:${e.ball},L${e.cushion}`;
    case 'jaw':
      return `ball_circular_cushion:${e.ball},C${e.jaw}`;
    case 'pocket':
      return `ball_pocket:${e.ball},P${e.pocket}`;
    case 'transition':
      return `${TRANSITIONS[`${e.from}-${e.to}`]}:${e.ball}`;
  }
}

function run(scenario: Scenario) {
  const balls = scenario.balls.map((b) => {
    const s = ballState(b.x, b.y, R, (b.s ?? 0) as Motion);
    if (b.v) [s.vx, s.vy] = [b.v[0]!, b.v[1]!];
    if (b.w) [s.wx, s.wy, s.wz] = [b.w[0]!, b.w[1]!, b.w[2]!];
    return s;
  });
  const c = scenario.cue;
  const rad = Math.PI / 180;
  const shot = c && {
    ball: c.ball,
    V0: c.V0,
    cosPhi: Math.cos(c.phi * rad),
    sinPhi: Math.sin(c.phi * rad),
    cosTheta: Math.cos(c.theta * rad),
    sinTheta: Math.sin(c.theta * rad),
    a: c.a,
    b: c.b,
  };
  return simulate(balls, shot, buildTable(tableSpec(scenario.size)).physics);
}

const all = scenarios as Record<string, Scenario>;
const reference = results as Record<string, Result>;

/**
 * Where pooltool 0.6.0 itself goes wrong, so the comparison stops there. In "draw" both balls roll
 * down the table with the same deceleration, which makes the two leading coefficients of the
 * contact quartic exactly zero; pooltool's quartic solver then returns four zero roots, and pooltool
 * resolves a "collision" between balls two metres apart. This port drops leading zeros and solves
 * the quadratic that remains (docs/physics.md).
 */
const POOLTOOL_FAULTS: Record<string, number> = { draw: 6 };

describe('the translation against pooltool 0.6.0', () => {
  it.each(Object.keys(all))('%s', (name) => {
    const timeline = run(all[name]!);
    const expected = reference[name]!;
    const stop = POOLTOOL_FAULTS[name] ?? expected.events.length;
    const ours = timeline.events.slice(0, stop);
    expect(ours.map(asPooltool)).toEqual(
      expected.events.slice(0, stop).map((e) => `${e.type}:${e.ids.join(',')}`),
    );
    let worst = 0;
    ours.forEach((e, i) => (worst = Math.max(worst, Math.abs(e.t - expected.events[i]!.t))));
    expect(worst).toBeLessThan(1e-8);
    if (name in POOLTOOL_FAULTS) return;
    expect(timeline.events.length).toBe(expected.events.length);
    for (const [id, end] of Object.entries(expected.final)) {
      const ball = timeline.final[Number(id)]!;
      expect(ball.s).toBe(end.s);
      if (end.s === 4) continue; // pocketed: both place it in the pocket
      expect(Math.hypot(ball.rx - end.r[0]!, ball.ry - end.r[1]!)).toBeLessThan(1e-8);
    }
  });

  it("documents pooltool's fault in 'draw': a collision of balls two metres apart", () => {
    const fault = reference.draw!.events[POOLTOOL_FAULTS.draw!]!;
    expect(fault.type).toBe('ball_ball');
    const timeline = run(all.draw!);
    // Where the balls really are at that moment, in this simulation (which matches pooltool's up
    // to there).
    const at = timeline.segments.map((list) => list.filter((s) => s.t <= fault.t).at(-1)!);
    expect(Math.hypot(at[0]!.rx - at[1]!.rx, at[0]!.ry - at[1]!.ry)).toBeGreaterThan(1);
  });
});
