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

// The balls' pictures on the players' cards: round, in the balls' own colours and markings, and
// lit from the upper left.

import { describe, expect, it } from 'vitest';
import { ballPixels } from '../../src/ui/ballPreview.ts';

const SIZE = 32;
const at = (data: Uint8ClampedArray, x: number, y: number) => {
  const i = (y * SIZE + x) * 4;
  return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]!, a: data[i + 3]! };
};

describe("the balls' pictures", () => {
  it('are round: clear outside the ball, solid inside, soft at the edge', () => {
    const three = ballPixels(3, SIZE);
    expect(at(three, 0, 0).a).toBe(0);
    expect(at(three, SIZE - 1, SIZE - 1).a).toBe(0);
    expect(at(three, 16, 4).a).toBe(255);
    const alphas = Array.from({ length: SIZE * SIZE }, (_, i) => three[i * 4 + 3]!);
    expect(alphas.filter((a) => a > 0 && a < 255).length).toBeGreaterThan(SIZE);
  });

  it('wear their markings: the 3 red, the 11 white above the red band round its middle', () => {
    const three = at(ballPixels(3, SIZE), 24, 10);
    expect(three.r).toBeGreaterThan(2 * three.g);
    const eleven = ballPixels(11, SIZE);
    const top = at(eleven, 16, 3);
    expect(Math.min(top.r, top.g, top.b)).toBeGreaterThan(150);
    const band = at(eleven, 27, 14);
    expect(band.r).toBeGreaterThan(2 * band.g);
  });

  it('carry their number in a white disc at the front', () => {
    const one = ballPixels(1, SIZE);
    // Across the disc, just below the middle, both the white disc and the dark number show.
    const row = Array.from({ length: 12 }, (_, i) => at(one, 8 + i, 19));
    expect(row.some((p) => Math.min(p.r, p.g, p.b) > 170)).toBe(true);
    expect(row.some((p) => Math.max(p.r, p.g, p.b) < 70)).toBe(true);
  });

  it('are lit from the upper left', () => {
    const two = ballPixels(2, SIZE);
    const light = at(two, 9, 9);
    const dark = at(two, 23, 23);
    expect(light.r + light.g + light.b).toBeGreaterThan(dark.r + dark.g + dark.b);
  });
});
