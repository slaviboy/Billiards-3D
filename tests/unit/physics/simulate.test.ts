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

// The simulation against what billiards physics says in closed form: a stun shot rolls on at 5/7
// of its speed, a rolling ball stops after v²/(2·μr·g), a ball struck 2R/5 above centre rolls at
// once, a head-on stun hit splits the speed (1±e)/2, a stun cut sends the balls off near 90°
// apart, a rolling half-ball hit deflects the cue ball near 30°, draw comes back and follow goes on.

import { describe, expect, it } from 'vitest';
import {
  ballState,
  Motion,
  POOL_BALL,
  POOL_CUE,
  sampleInto,
  simulate,
  stateHash,
  type BallState,
  type PhysicsEvent,
  type Strike,
  type Timeline,
} from '../../../src/physics/index.ts';
import { buildTable } from '../../../src/table/geometry.ts';
import { tableSpec } from '../../../src/table/spec.ts';

const p = POOL_BALL;
const R = p.R;
const g = p.g;
const table = buildTable(tableSpec('9ft')).physics;
const W = table.W;
const L = table.L;

function ball(x: number, y: number): BallState {
  return ballState(x, y, R);
}

function aim(
  ballIndex: number,
  V0: number,
  headingDeg: number,
  a = 0,
  b = 0,
  elevationDeg = 0,
): Strike {
  const phi = (headingDeg * Math.PI) / 180;
  const theta = (elevationDeg * Math.PI) / 180;
  return {
    ball: ballIndex,
    V0,
    cosPhi: Math.cos(phi),
    sinPhi: Math.sin(phi),
    cosTheta: Math.cos(theta),
    sinTheta: Math.sin(theta),
    a,
    b,
  };
}

/** Cue speed that gives the cue ball speed v with a centre hit. */
const cueSpeedFor = (v: number) => (v * (1 + p.m / POOL_CUE.M)) / 2;

function at(timeline: Timeline, i: number, t: number): BallState {
  return sampleInto(timeline, i, t, ball(0, 0));
}

function first<K extends PhysicsEvent['kind']>(
  timeline: Timeline,
  kind: K,
  where: (e: Extract<PhysicsEvent, { kind: K }>) => boolean = () => true,
): Extract<PhysicsEvent, { kind: K }> | undefined {
  return timeline.events.find(
    (e): e is Extract<PhysicsEvent, { kind: K }> =>
      e.kind === kind && where(e as Extract<PhysicsEvent, { kind: K }>),
  );
}

const speedOf = (b: BallState) => Math.hypot(b.vx, b.vy);
const degrees = (rad: number) => (rad * 180) / Math.PI;
const angleBetween = (ax: number, ay: number, bx: number, by: number) =>
  degrees(Math.acos((ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by))));

describe('a single ball', () => {
  it('stays put when nothing strikes it', () => {
    const t = simulate([ball(0.5, 0.5)], null, table);
    expect(t.events).toEqual([]);
    expect(t.duration).toBe(0);
  });

  it('slides, rolls on at 5/7 of its speed, and stops after the closed-form distance', () => {
    const v0 = 0.42;
    const t = simulate([ball(W / 2, 0.5)], aim(0, cueSpeedFor(v0), 90), table);
    const start = t.segments[0]![0]!;
    expect(speedOf(start)).toBeCloseTo(v0, 12);
    const roll = first(t, 'transition', (e) => e.from === Motion.Sliding)!;
    const tSlide = (2 * v0) / (7 * p.us * g);
    expect(roll.t).toBeCloseTo(tSlide, 12);
    const rolling = at(t, 0, roll.t);
    expect(speedOf(rolling)).toBeCloseTo((5 / 7) * v0, 12);
    const slideDistance = v0 * tSlide - 0.5 * p.us * g * tSlide * tSlide;
    const rollDistance = ((5 / 7) * v0) ** 2 / (2 * p.ur * g);
    const end = t.final[0]!;
    expect(end.s).toBe(Motion.Stationary);
    expect(end.ry - 0.5).toBeCloseTo(slideDistance + rollDistance, 10);
    expect(end.rx).toBeCloseTo(W / 2, 12);
  });

  it('rolls at once when struck 2R/5 above centre', () => {
    const t = simulate([ball(W / 2, 0.5)], aim(0, 0.5, 90, 0, 0.4), table);
    const s = t.segments[0]![0]!;
    const slip = Math.hypot(s.vx - R * s.wy, s.vy + R * s.wx);
    expect(slip / speedOf(s)).toBeLessThan(1e-12);
  });

  it('squirts away from the side of the cue tip', () => {
    const left = simulate([ball(W / 2, 0.5)], aim(0, 1, 90, 0.3), table).segments[0]![0]!;
    const right = simulate([ball(W / 2, 0.5)], aim(0, 1, 90, -0.3), table).segments[0]![0]!;
    // Aimed along +y; positive a is left of centre (as the shooter sees it), which squirts the
    // ball to the shooter's right, here −x... in the table frame +x is to the shooter's right.
    expect(Math.sign(left.vx)).toBe(-Math.sign(right.vx));
    expect(Math.abs(left.vx)).toBeGreaterThan(1e-3);
    expect(left.wz).toBeCloseTo(-right.wz, 12);
  });
});

describe('two balls', () => {
  it('splits a head-on stun hit (1−e)/2 and (1+e)/2', () => {
    // Close enough that the cue ball still slides with little spin at contact.
    const t = simulate([ball(W / 2, 0.5), ball(W / 2, 0.5 + 2 * R + 0.02)], aim(0, 2, 90), table);
    const hit = first(t, 'ball')!;
    const before = at(t, 0, hit.t - 1e-12);
    const cue = t.segments[0]!.find((s) => s.t === hit.t)!;
    const object = t.segments[1]!.find((s) => s.t === hit.t)!;
    const v = before.vy;
    expect(cue.vy / v).toBeCloseTo((1 - p.eb) / 2, 9);
    expect(object.vy / v).toBeCloseTo((1 + p.eb) / 2, 9);
    // (Sampled 1e-12 s before contact, while friction still slows the cue ball.)
    expect((cue.vy + object.vy) / v).toBeCloseTo(1, 9);
  });

  // Restitution below 1 leaves the cue ball (1−e)/2 of its normal speed, and friction throws the
  // object ball off the line of centres: both close the angle a little below 90°.
  it('sends a stun cut off near 90° apart', () => {
    // Cue ball sliding without spin, meeting the object ball at a 30° cut.
    const cut = (30 * Math.PI) / 180;
    const cueBall = ball(W / 2, 0.8);
    cueBall.vy = 1.5;
    cueBall.s = Motion.Sliding;
    const object = ball(W / 2 + 2 * R * Math.sin(cut), 0.8 + 0.001 + 2 * R * Math.cos(cut));
    const t = simulate([cueBall, object], null, table);
    const hit = first(t, 'ball')!;
    const a = t.segments[0]!.find((s) => s.t === hit.t)!;
    const b = t.segments[1]!.find((s) => s.t === hit.t)!;
    expect(angleBetween(a.vx, a.vy, b.vx, b.vy)).toBeGreaterThan(82);
    expect(angleBetween(a.vx, a.vy, b.vx, b.vy)).toBeLessThan(90);
  });

  it('deflects a rolling cue ball near 30° on a half-ball hit', () => {
    const cueBall = ball(W / 2, 0.5);
    cueBall.vy = 1.2;
    cueBall.wx = -1.2 / R; // natural roll along +y: ω = (−v_y, v_x)/R
    cueBall.s = Motion.Rolling;
    const object = ball(W / 2 + R, 0.9); // half-ball: centres offset by R
    const t = simulate([cueBall, object], null, table);
    const hit = first(t, 'ball')!;
    // Its direction once it rolls again after the hit.
    const rolled = first(t, 'transition', (e) => e.ball === 0 && e.t > hit.t)!;
    const after = at(t, 0, rolled.t);
    const deflection = angleBetween(0, 1, after.vx, after.vy);
    expect(deflection).toBeGreaterThan(26);
    expect(deflection).toBeLessThan(35);
  });

  it('draws back with low spin and follows through with high spin', () => {
    // The cue ball's direction once its spin has taken hold after the hit.
    const run = (b: number) => {
      const t = simulate([ball(W / 2, 0.6), ball(W / 2, 0.6 + 0.3)], aim(0, 2.2, 90, 0, b), table);
      const hit = first(t, 'ball')!;
      const rolled = first(t, 'transition', (e) => e.ball === 0 && e.t > hit.t)!;
      return at(t, 0, rolled.t).vy;
    };
    expect(run(-0.5)).toBeLessThan(-0.2);
    expect(run(0.5)).toBeGreaterThan(0.2);
  });

  it('passes most of the motion down a line of balls', () => {
    const gap = 1e-4;
    const t = simulate(
      [
        ball(W / 2, 0.5),
        ball(W / 2, 1.0),
        ball(W / 2, 1.0 + 2 * R + gap),
        ball(W / 2, 1.0 + 4 * R + 2 * gap),
      ],
      aim(0, 0.5, 90),
      table,
    );
    const [c, , b2, b3] = t.final.map((s) => s.ry);
    expect(b3! - (1.0 + 4 * R + 2 * gap)).toBeGreaterThan(0.1);
    expect(b3! - b2!).toBeGreaterThan(0.1);
    expect(c!).toBeLessThan(1.0);
  });
});

describe('cushions and pockets', () => {
  it('banks off a rail with the speed falling and the ball moving away', () => {
    // Toward the left rail, meeting it midway between the corner and the side pocket.
    const t = simulate([ball(W / 2, 0.25)], aim(0, 1.5, 135), table);
    const bank = first(t, 'cushion')!;
    expect(bank.cushion).toBeLessThan(6); // a rail, not a facing
    const before = at(t, 0, bank.t - 1e-9);
    const after = t.segments[0]!.find((s) => s.t === bank.t)!;
    expect(before.vx).toBeLessThan(0);
    expect(after.vx).toBeGreaterThan(0);
    expect(speedOf(after)).toBeLessThan(speedOf(before));
    // Restitution e_c on the normal speed (the contact point's, which is the centre's here).
    expect(after.vx / -before.vx).toBeGreaterThan(0.6);
    expect(after.vx / -before.vx).toBeLessThan(0.9);
  });

  it('drops a ball sent straight down the middle of a corner pocket', () => {
    const t = simulate([ball(0.4, 0.4)], aim(0, 1, 225), table);
    const drop = first(t, 'pocket')!;
    expect(drop.pocket).toBe(0);
    expect(t.final[0]!.s).toBe(Motion.Pocketed);
  });

  it('drops a ball sent straight into a side pocket', () => {
    const t = simulate([ball(0.6, L / 2)], aim(0, 1, 180), table);
    expect(first(t, 'pocket')?.pocket).toBe(1);
  });

  // Along the corner pocket's axis, offset toward the head rail's lip.
  const towardCorner = (offset: number) => {
    const corner = buildTable(tableSpec('9ft')).pockets[0]!;
    const mid = {
      x: (corner.lips[0].x + corner.lips[1].x) / 2,
      y: (corner.lips[0].y + corner.lips[1].y) / 2,
    };
    const along = 0.3 / Math.SQRT2;
    const across = offset / Math.SQRT2;
    return simulate(
      [ball(mid.x + along + across, mid.y + along - across)],
      aim(0, 0.8, 225),
      table,
    );
  };

  it('drops a ball that only grazes the jaw, and rattles one in off both facings', () => {
    const graze = towardCorner(0.03);
    expect(graze.events.find((e) => e.kind === 'jaw')).toBeDefined();
    expect(first(graze, 'pocket')?.pocket).toBe(0);
    const rattle = towardCorner(0.035);
    const facings = rattle.events.filter((e) => e.kind === 'cushion' && e.cushion >= 6);
    expect(facings.length).toBeGreaterThanOrEqual(1);
    expect(first(rattle, 'pocket')?.pocket).toBe(0);
  });

  it('keeps out a ball that meets the cushion beside the lip', () => {
    for (const offset of [0.045, 0.075]) {
      const t = towardCorner(offset);
      expect(t.events.find((e) => e.kind === 'cushion')).toBeDefined();
      expect(first(t, 'pocket')).toBeUndefined();
    }
  });

  it('takes a slow ball rolling along the rail into the corner', () => {
    const start = ball(R + 0.0005, 0.6);
    start.vy = -0.6;
    start.wx = 0.6 / R;
    start.s = Motion.Rolling;
    const t = simulate([start], null, table);
    expect(first(t, 'pocket')?.pocket).toBe(0);
  });
});

describe('a break', () => {
  const rack = (): BallState[] => {
    const balls = [ball(W / 2, L / 4)];
    const spacing = 2 * R * (1 + 1e-3);
    const apex = { x: W / 2, y: (3 * L) / 4 };
    let seed = 12345;
    const jitter = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed / 4294967296 - 0.5) * 2e-5;
    };
    for (let row = 0; row < 5; row++) {
      for (let k = 0; k <= row; k++) {
        balls.push(
          ball(
            apex.x + (k - row / 2) * spacing + jitter(),
            apex.y + row * spacing * (Math.sqrt(3) / 2) + jitter(),
          ),
        );
      }
    }
    return balls;
  };

  it('ends with every ball at rest, apart, and on the table or in a pocket', () => {
    const started = performance.now();
    const t = simulate(rack(), aim(0, 7, 90, 0, -0.1), table);
    const elapsed = performance.now() - started;
    expect(t.truncated).toBe(false);
    expect(t.events.length).toBeGreaterThan(30);
    expect(elapsed).toBeLessThan(500);
    checkFinal(t);
  });

  it('is deterministic: the same break twice gives the same table, bit for bit', () => {
    const a = simulate(rack(), aim(0, 7, 90.3, 0.05, -0.1), table);
    const b = simulate(rack(), aim(0, 7, 90.3, 0.05, -0.1), table);
    expect(stateHash(a.final)).toBe(stateHash(b.final));
    expect(a.events.length).toBe(b.events.length);
  });
});

describe('invariants over many random shots', () => {
  it('terminates, conserves momentum in collisions, never gains energy, never overlaps', () => {
    let seed = 99;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let shot = 0; shot < 300; shot++) {
      const balls: BallState[] = [];
      while (balls.length < 6) {
        const candidate = ball(
          R + 0.01 + random() * (W - 2 * R - 0.02),
          R + 0.01 + random() * (L - 2 * R - 0.02),
        );
        if (
          balls.every((b) => Math.hypot(b.rx - candidate.rx, b.ry - candidate.ry) > 2 * R + 0.001)
        ) {
          balls.push(candidate);
        }
      }
      const offset = random() * 0.5;
      const angle = random() * Math.PI * 2;
      const t = simulate(
        balls,
        aim(
          0,
          0.5 + random() * 6,
          random() * 360,
          offset * Math.cos(angle),
          offset * Math.sin(angle),
        ),
        table,
      );
      expect(t.truncated).toBe(false);
      checkFinal(t);
      checkEvents(t);
    }
  });
});

function checkFinal(t: Timeline) {
  const pockets = buildTable(tableSpec('9ft')).pockets;
  const live = t.final.filter((b) => b.s !== Motion.Pocketed);
  for (const b of t.final) expect([Motion.Stationary, Motion.Pocketed]).toContain(b.s);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const d = Math.hypot(live[i]!.rx - live[j]!.rx, live[i]!.ry - live[j]!.ry);
      expect(d).toBeGreaterThan(2 * R - 1e-9);
    }
    const b = live[i]!;
    const inside = b.rx > R - 1e-6 && b.rx < W - R + 1e-6 && b.ry > R - 1e-6 && b.ry < L - R + 1e-6;
    const nearPocket = pockets.some(
      (pk) => Math.hypot(b.rx - pk.center.x, b.ry - pk.center.y) < 0.12,
    );
    expect(inside || nearPocket).toBe(true);
  }
}

function totalEnergy(states: readonly BallState[]): number {
  let e = 0;
  for (const s of states) {
    e += (p.m * (s.vx * s.vx + s.vy * s.vy)) / 2;
    e += ((2 / 5) * p.m * R * R * (s.wx * s.wx + s.wy * s.wy + s.wz * s.wz)) / 2;
  }
  return e;
}

function checkEvents(t: Timeline) {
  const n = t.final.length;
  for (const event of t.events) {
    if (event.kind === 'stick') continue;
    const before: BallState[] = [];
    const after: BallState[] = [];
    for (let i = 0; i < n; i++) {
      // Just before: the segment in force before this event's own segments start.
      const list = t.segments[i]!;
      let k = list.length - 1;
      while (k > 0 && list[k]!.t >= event.t) k--;
      const prior = sampleInto(t, i, event.t, ball(0, 0));
      before.push(list[k]!.t < event.t ? sampleFrom(list[k]!, event.t) : prior);
      after.push(prior);
    }
    expect(totalEnergy(after)).toBeLessThanOrEqual(totalEnergy(before) * (1 + 1e-9) + 1e-12);
    if (event.kind === 'ball') {
      const sx = before[event.a]!.vx + before[event.b]!.vx;
      const sy = before[event.a]!.vy + before[event.b]!.vy;
      expect(after[event.a]!.vx + after[event.b]!.vx).toBeCloseTo(sx, 9);
      expect(after[event.a]!.vy + after[event.b]!.vy).toBeCloseTo(sy, 9);
    }
  }
}

function sampleFrom(segment: BallState, t: number): BallState {
  const out = ball(0, 0);
  const timeline: Timeline = {
    events: [],
    segments: [[segment]],
    final: [segment],
    duration: Infinity,
    truncated: false,
  };
  return sampleInto(timeline, 0, t, out);
}
