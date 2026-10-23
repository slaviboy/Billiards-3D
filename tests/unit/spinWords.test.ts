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

// The spin in words under the dock's cue ball: top or draw and side, in eighths of the ball's
// radius, "Stun" and "No side" at the centre.

import { describe, expect, it } from 'vitest';
import { spinWords } from '../../src/ui/modern/ShotControls.ts';

describe('the spin in words', () => {
  it('says stun and no side at the centre', () => {
    expect(spinWords(0, 0)).toEqual(['Stun', 'No side']);
    expect(spinWords(0.03, -0.03)).toEqual(['Stun', 'No side']);
  });

  it('names top, draw, left and right in eighths of the radius', () => {
    expect(spinWords(0, 0.25)).toEqual(['Top ¼', 'No side']);
    expect(spinWords(0, -0.375)).toEqual(['Draw ⅜', 'No side']);
    expect(spinWords(0.125, 0)).toEqual(['Stun', 'Left ⅛']);
    expect(spinWords(-0.5, 0.5)).toEqual(['Top ½', 'Right ½']);
  });
});
