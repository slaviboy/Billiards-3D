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

// A fixed set of shots whose outcomes every JavaScript engine must agree on to the last bit: 30
// breaks and 70 shots among six scattered balls, all derived from integers. Node writes the
// expected fingerprints (scripts/determinism-hashes.ts); a unit test checks Node against them, and
// an end-to-end test runs the same shots in Chromium, Firefox and WebKit. Not part of the game.

import { cos, PI, sin } from './dmath.ts';
import { stateHash } from './hash.ts';
import { simulate } from './simulate.ts';
import type { Strike } from './resolve/stick.ts';
import { ballState, type BallState } from './state.ts';
import type { PhysicsTable } from './types.ts';

const R = 0.028575;

function generator(seed: number) {
  let s = seed >>> 0;
  return {
    /** An integer in [0, n). */
    int(n: number): number {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return Math.floor((s / 4294967296) * n);
    },
  };
}

function aimAt(ball: number, V0: number, angle: number, a: number, b: number): Strike {
  return { ball, V0, cosPhi: cos(angle), sinPhi: sin(angle), cosTheta: 1, sinTheta: 0, a, b };
}

function rack(table: PhysicsTable, rng: ReturnType<typeof generator>): BallState[] {
  const { W, L } = table;
  const balls = [ballState(W / 2 + (rng.int(2001) - 1000) * 1e-4, L / 4, R)];
  const spacing = 2 * R * (1 + 1e-3);
  const rowStep = spacing * 0.8660254037844386; // √3/2
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k <= row; k++) {
      const jx = (rng.int(2001) - 1000) * 1e-8;
      const jy = (rng.int(2001) - 1000) * 1e-8;
      balls.push(
        ballState(W / 2 + (k - row / 2) * spacing + jx, (3 * L) / 4 + row * rowStep + jy, R),
      );
    }
  }
  return balls;
}

function scattered(table: PhysicsTable, rng: ReturnType<typeof generator>): BallState[] {
  const balls: BallState[] = [];
  while (balls.length < 6) {
    const x = R + 0.01 + rng.int(100000) * ((table.W - 2 * R - 0.02) / 100000);
    const y = R + 0.01 + rng.int(100000) * ((table.L - 2 * R - 0.02) / 100000);
    const apart = balls.every((b) => {
      const dx = b.rx - x;
      const dy = b.ry - y;
      return dx * dx + dy * dy > (2 * R + 0.001) * (2 * R + 0.001);
    });
    if (apart) balls.push(ballState(x, y, R));
  }
  return balls;
}

/** The fingerprint of each shot's outcome, with its number of events. */
export function determinismSuite(table: PhysicsTable): string[] {
  const out: string[] = [];
  const rng = generator(20261022);
  for (let i = 0; i < 30; i++) {
    const balls = rack(table, rng);
    const angle = PI / 2 + (rng.int(2001) - 1000) * 2e-5;
    const shot = aimAt(
      0,
      5 + rng.int(500) / 100,
      angle,
      (rng.int(41) - 20) / 100,
      (rng.int(61) - 30) / 100,
    );
    const timeline = simulate(balls, shot, table);
    out.push(`${stateHash(timeline.final)}:${timeline.events.length}`);
  }
  for (let i = 0; i < 70; i++) {
    const balls = scattered(table, rng);
    const angle = (rng.int(1 << 20) * (2 * PI)) / (1 << 20);
    const shot = aimAt(
      0,
      0.5 + rng.int(600) / 100,
      angle,
      (rng.int(81) - 40) / 100,
      (rng.int(81) - 40) / 100,
    );
    const timeline = simulate(balls, shot, table);
    out.push(`${stateHash(timeline.final)}:${timeline.events.length}`);
  }
  return out;
}
