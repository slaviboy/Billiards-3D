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

// The ball markings follow the WPA specification: colours by number, stripes on 9–15, the number
// twice, on opposite sides, one upside down, 6 and 9 underscored.

import { describe, expect, it } from 'vitest';
import {
  BALL_COLORS,
  BALL_INK,
  BALL_WHITE,
  hexToRgb,
  markingColor,
} from '../../../src/balls/markings.ts';
import { numberSegments } from '../../../src/balls/digits.ts';

const colour = (hex: string) => hexToRgb(hex);

describe('ball markings', () => {
  it('colours solids all round and stripes only in the band', () => {
    expect(markingColor(3, 1, 0, 0)).toEqual(colour(BALL_COLORS[3]!));
    expect(markingColor(3, 0, 1, 0)).toEqual(colour(BALL_COLORS[3]!)); // the pole of a solid
    expect(markingColor(11, 1, 0, 0)).toEqual(colour(BALL_COLORS[11]!)); // the band
    expect(markingColor(11, 0, 1, 0)).toEqual(colour(BALL_WHITE)); // the white cap
    expect(markingColor(0, 0, 0, 1)).toEqual(colour(BALL_COLORS[0]!)); // the cue ball is plain
  });

  it('prints the number in a white disc on both sides', () => {
    // Just inside the disc's edge, between the number's strokes: white.
    expect(markingColor(1, 0.38, 0, 0.92)).toEqual(colour(BALL_WHITE));
    // The 1's stem runs through the disc's centre: ink.
    expect(markingColor(1, 0, 0, 1)).toEqual(colour(BALL_INK));
    expect(markingColor(1, 0, 0, -1)).toEqual(colour(BALL_INK));
  });

  it('turns the second number upside down', () => {
    for (const n of [2, 7, 12]) {
      for (const [u, v] of [
        [0.1, 0.15],
        [-0.12, -0.2],
        [0.05, 0.25],
      ] as const) {
        const z = Math.sqrt(1 - u * u - v * v);
        expect(markingColor(n, u, v, z)).toEqual(markingColor(n, u, -v, -z));
      }
    }
  });

  it('underscores only the 6 and the 9', () => {
    const lowest = (n: number) => Math.min(...numberSegments(n).filter((_, i) => i % 2 === 1));
    expect(lowest(6)).toBeLessThan(-0.55);
    expect(lowest(9)).toBeLessThan(-0.55);
    for (const n of [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14, 15]) {
      expect(lowest(n)).toBeGreaterThan(-0.45);
    }
  });
});
