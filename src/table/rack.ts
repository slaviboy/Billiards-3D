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

// The 8-ball rack (WPA Rules of Play 4.2): fifteen balls in a triangle with the apex ball on the
// foot spot, the 8 in the middle of the third row, a solid and a stripe in the two back corners,
// the rest in no particular pattern. A seed shared by both players decides the arrangement, so both
// build the same rack.
//
// As in pooltool's rack layouts, neighbouring balls stand a hair apart (a thousandth of a radius
// of gap, plus a jitter of a few micrometres): a real rack's balls never touch perfectly evenly,
// and the tiny differences decide which ball takes the break's impulse first, the same way on
// every computer.

import { ballState, type BallState } from '../physics/state.ts';
import type { TableGeometry } from './geometry.ts';
import { BALL_RADIUS } from './spec.ts';

const R = BALL_RADIUS;
const SPACING = 2 * R * (1 + 1e-3);
const ROW_STEP = SPACING * 0.8660254037844386; // √3/2
const JITTER = 4e-6;

/** A small deterministic generator (a linear congruential sequence) for shared choices. */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** An integer in [0, n). */
  int(n: number): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return Math.floor((this.state / 4294967296) * n);
  }

  /** A number in [−1, 1], in steps of 1/1000. */
  unit(): number {
    return (this.int(2001) - 1000) / 1000;
  }
}

/** A 32-bit seed from a text seed (FNV-1a over its character codes). */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Where the cue ball waits for the break: on the long string, a hand's width above the head string. */
export function breakSpot(table: TableGeometry): { x: number; y: number } {
  return { x: table.spec.W / 2, y: table.headString - 0.12 };
}

/**
 * All sixteen balls for a new rack: index 0 is the cue ball (at the break spot), index n the
 * ball numbered n.
 */
export function rackBalls(table: TableGeometry, seed: number): BallState[] {
  const random = new SeededRandom(seed);
  // Triangle positions, row by row from the apex (row r has r + 1 balls).
  const spots: { x: number; y: number }[] = [];
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k <= row; k++) {
      spots.push({
        x: table.footSpot.x + (k - row / 2) * SPACING + JITTER * random.unit(),
        y: table.footSpot.y + row * ROW_STEP + JITTER * random.unit(),
      });
    }
  }
  // Spot numbers: the middle of row 3 is index 4; the back corners are 10 and 14.
  const number = new Array<number>(15).fill(0);
  number[4] = 8;
  const solid = 1 + random.int(7);
  const stripe = 9 + random.int(7);
  const solidLeft = random.int(2) === 0;
  number[10] = solidLeft ? solid : stripe;
  number[14] = solidLeft ? stripe : solid;
  const rest: number[] = [];
  for (let n = 1; n <= 15; n++) if (n !== 8 && n !== solid && n !== stripe) rest.push(n);
  // Fisher-Yates with the shared generator.
  for (let i = rest.length - 1; i > 0; i--) {
    const j = random.int(i + 1);
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  for (let i = 0, k = 0; i < 15; i++) if (number[i] === 0) number[i] = rest[k++]!;

  const start = breakSpot(table);
  const balls: BallState[] = [ballState(start.x, start.y, R)];
  for (let n = 1; n <= 15; n++) {
    const spot = spots[number.indexOf(n)]!;
    balls.push(ballState(spot.x, spot.y, R));
  }
  return balls;
}
