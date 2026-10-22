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

// The root finder: exact answers on simple cases, every root of pooltool's test quartics (including
// its pathological set: close, near-repeated and triple roots, and wildly different scales), and the
// "first time a gap closes" query the collision detection uses.

import { describe, expect, it } from 'vitest';
import { firstFall, polyval, realRootsIn } from '../../../src/physics/roots.ts';
import hard from '../../fixtures/pooltool/hard-quartics.json' with { type: 'json' };
import standard from '../../fixtures/pooltool/quartics.json' with { type: 'json' };

interface Case {
  readonly c: number[];
  readonly r: number[];
  readonly k?: number;
}

/** Coefficients (highest first) of the monic polynomial with these roots. */
function fromRoots(roots: readonly number[]): number[] {
  let c = [1];
  for (const r of roots) {
    const next = [...c, 0];
    for (let i = 1; i < next.length; i++) next[i] = next[i]! - r * c[i - 1]!;
    c = next;
  }
  return c;
}

function cauchyBound(c: readonly number[]): number {
  let m = 0;
  for (let i = 1; i < c.length; i++) m = Math.max(m, Math.abs(c[i]! / c[0]!));
  return 1 + m;
}

const relErr = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

describe('realRootsIn', () => {
  it('finds the four roots of a well-separated quartic', () => {
    const roots = realRootsIn(fromRoots([1, 2, 3, 4]), -10, 10);
    expect(roots).toHaveLength(4);
    roots.forEach((r, i) => expect(r).toBeCloseTo(i + 1, 12));
  });

  it('keeps to the interval', () => {
    const roots = realRootsIn(fromRoots([1, 2, 3, 4]), 1.5, 3.5);
    expect(roots).toHaveLength(2);
    expect(roots[0]).toBeCloseTo(2, 12);
    expect(roots[1]).toBeCloseTo(3, 12);
  });

  it('handles lower degrees and leading zeros', () => {
    expect(realRootsIn([0, 0, 2, -4], -10, 10)).toEqual([2]);
    expect(realRootsIn([0, 1, 0, -9], -10, 10).map((x) => +x.toFixed(12))).toEqual([-3, 3]);
    expect(realRootsIn([0, 0, 0, 5], -10, 10)).toEqual([]);
    expect(realRootsIn([1, 0, 1], -10, 10)).toEqual([]);
  });

  it('finds every root of the standard pooltool quartics', () => {
    let worst = 0;
    for (const item of (standard as { items: Case[] }).items) {
      const bound = cauchyBound(item.c);
      const found = realRootsIn(item.c, -bound, bound);
      const distinct = item.r.filter((r, i) =>
        item.r.every((s, j) => j === i || relErr(s, r) > 1e-6),
      );
      for (const r of distinct) {
        worst = Math.max(worst, Math.min(...found.map((f) => relErr(f, r))));
      }
      for (const f of found) {
        expect(Math.min(...item.r.map((r) => relErr(f, r)))).toBeLessThan(1e-6);
      }
    }
    expect(worst).toBeLessThan(1e-12);
  });

  // Case 5 of that set (roots 10³⁰ to 10¹⁰⁰ apart from small ones) is left out: there the
  // polynomial's value near its small roots is below the rounding error of computing it, so those
  // roots are not determined in double precision at all. The simulation's polynomials are in
  // seconds and metres, with coefficients of order one.
  it('finds the roots of the pathological pooltool quartics', () => {
    const items = (hard as { items: Case[] }).items.filter((item) => item.k !== 5);
    const worstByCase = new Map<number, number>();
    let spurious = 0;
    for (const item of items) {
      const bound = cauchyBound(item.c);
      const found = realRootsIn(item.c, -bound, bound);
      for (const f of found) {
        if (Math.min(...item.r.map((r) => relErr(f, r))) > 1e-3) spurious++;
      }
      // Every root that crosses zero (odd multiplicity) must be found; a double root only touches
      // zero and is found where rounding allows.
      const crossing = item.r.filter(
        (r) => item.r.filter((s) => relErr(s, r) < 1e-12).length % 2 === 1,
      );
      let worst = 0;
      for (const r of crossing) {
        worst = Math.max(worst, Math.min(...found.map((f) => relErr(f, r))));
      }
      worstByCase.set(item.k!, Math.max(worstByCase.get(item.k!) ?? 0, worst));
    }
    expect(spurious).toBe(0);
    // Widely separated roots, and clusters at very different scales: to full precision.
    expect(worstByCase.get(0)).toBeLessThan(1e-12);
    expect(worstByCase.get(2)).toBeLessThan(1e-12);
    // Roots 10⁻⁴ apart, near-repeated and near-triple roots: as close as rounding lets them be
    // told apart, within the 1e-3 that pooltool's own tests ask of its solver.
    expect(worstByCase.get(1)).toBeLessThan(1e-3);
    expect(worstByCase.get(3)).toBeLessThan(1e-3);
    expect(worstByCase.get(4)).toBeLessThan(1e-3);
  });
});

describe('firstFall', () => {
  it('returns the moment a gap closes, just before contact', () => {
    const c = fromRoots([2, 5]); // positive before 2
    const t = firstFall(c, 10);
    expect(t).toBeCloseTo(2, 12);
    expect(polyval(c, t)).toBeGreaterThanOrEqual(0);
  });

  it('ignores contacts beyond the horizon', () => {
    expect(firstFall(fromRoots([2, 5]), 1.9)).toBe(Infinity);
  });

  it('waits for the gap to open before looking for it to close', () => {
    const c = fromRoots([1, 3]).map((x) => -x); // negative until 1, positive until 3
    expect(firstFall(c, 10)).toBeCloseTo(3, 12);
  });

  it('counts an exact touch as contact', () => {
    expect(firstFall(fromRoots([2, 2]), 10)).toBe(2);
  });

  it('matches the closed form for two balls approaching at constant speed', () => {
    // Centres 0.5 m apart closing at 1.3 m/s; contact when the gap 0.5 - 2R is used up.
    const R = 0.028575;
    const d = 0.5;
    const v = 1.3;
    const c = [v * v, -2 * d * v, d * d - 4 * R * R]; // (d - v t)² - (2R)²
    expect(firstFall(c, 10)).toBeCloseTo((d - 2 * R) / v, 14);
  });

  it('always answers on the open side of contact', () => {
    let seed = 7;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 2000; i++) {
      const roots = [random() * 4, random() * 4, random() * 4 - 6, random() * 4 + 5];
      const scale = random() + 0.1;
      const c = fromRoots(roots).map((x) => x * scale);
      const t = firstFall(c, 4);
      if (t !== Infinity) expect(polyval(c, t)).toBeGreaterThanOrEqual(0);
    }
  });
});
