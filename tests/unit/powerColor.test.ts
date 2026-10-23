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

// The power bar's colour scale: mint with no power, red at full, gold in between, and nothing
// beyond its ends.

import { describe, expect, it } from 'vitest';
import { powerColor } from '../../src/ui/modern/ShotControls.ts';

const rgb = (p: number): [number, number, number] => {
  const [r, g, b] = powerColor(p).match(/\d+/g)!.map(Number);
  return [r!, g!, b!];
};

describe("the power bar's colours", () => {
  it('run from mint to red', () => {
    expect(powerColor(0)).toBe('rgb(69, 211, 154)');
    expect(powerColor(1)).toBe('rgb(239, 90, 90)');
    expect(powerColor(0.6)).toBe('rgb(244, 201, 93)');
  });

  it('blend between the stops, and keep to the ends', () => {
    const [r, g] = rgb(0.7);
    expect(r).toBeGreaterThanOrEqual(244);
    expect(g).toBeGreaterThan(154);
    expect(g).toBeLessThan(201);
    expect(powerColor(-1)).toBe(powerColor(0));
    expect(powerColor(2)).toBe(powerColor(1));
  });

  it('grow redder as the power rises', () => {
    let last = -Infinity;
    for (let p = 0; p <= 1; p += 0.05) {
      const [r, g] = rgb(p);
      const redness = r - g;
      expect(redness).toBeGreaterThanOrEqual(last - 1);
      last = redness;
    }
  });
});
