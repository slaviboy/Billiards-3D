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

// Real roots of the small polynomials the simulation asks about: "when do these two balls touch",
// "when does this ball reach that cushion". Each is a polynomial in time of degree four at most,
// asked about a finite stretch of time: a ball's path is a known quadratic only until its next
// change of motion, so nothing beyond that can matter.
//
// The method needs no trigonometry and no cube roots, so every browser computes the same bits.
// The roots of the derivative split the interval into pieces on which the polynomial only rises
// or only falls (found the same way, one degree lower, down to a straight line); a piece whose ends
// have opposite signs holds exactly one root, which a bracketed solver closes in on.
//
// Coefficients are given highest power first: [a, b, c, d, e] is a·t⁴ + b·t³ + c·t² + d·t + e.

/** p(x) by Horner's rule. */
export function polyval(c: readonly number[], x: number): number {
  let y = 0;
  for (let i = 0; i < c.length; i++) y = y * x + c[i]!;
  return y;
}

/**
 * Whether p(x), computed as fx, is zero within the rounding error of computing it: Horner's rule
 * is off by at most about 2n·ε·Σ|cᵢ||x|ⁱ. Used at the turning points of p, where a contact that only
 * just touches (or just misses) is decided by rounding noise; calling it a touch is the safe side,
 * and the bound is computed the same way everywhere.
 */
function nearZero(c: readonly number[], x: number, fx: number): boolean {
  let scale = 0;
  const ax = Math.abs(x);
  for (let i = 0; i < c.length; i++) scale = scale * ax + Math.abs(c[i]!);
  return Math.abs(fx) <= 2 * c.length * Number.EPSILON * scale;
}

/** The coefficients without leading zeros (a zero polynomial keeps its last coefficient). */
function trimmed(c: readonly number[]): number[] {
  let i = 0;
  while (i < c.length - 1 && c[i] === 0) i++;
  return c.slice(i);
}

function derivative(c: readonly number[]): number[] {
  const degree = c.length - 1;
  const d: number[] = [];
  for (let i = 0; i < degree; i++) d.push(c[i]! * (degree - i));
  return d;
}

/**
 * The root of p between lo and hi, where p is monotonic and changes sign. Returns a point on lo's
 * side of the root (where p still has the sign it has at lo), at most a few units in the last place
 * away, or the root itself when p is exactly zero there.
 *
 * Illinois method: regula falsi that halves the stale end's value whenever the same end moves
 * twice, so both ends close in; a bisection step stands in whenever a step would leave the bracket
 * or the bracket stops shrinking.
 */
function solveBracket(
  c: readonly number[],
  lo: number,
  hi: number,
  flo: number,
  fhi: number,
): number {
  let a = lo;
  let b = hi;
  let fa = flo;
  let fb = fhi;
  const aPositive = flo > 0;
  let side = 0;
  let checkpoint = b - a;
  for (let i = 1; i <= 2000; i++) {
    let x = (fa * b - fb * a) / (fa - fb);
    // Every third step the bracket must have halved since the last check, or this step bisects.
    if (i % 3 === 0) {
      if (b - a > 0.5 * checkpoint) x = split(a, b);
      checkpoint = b - a;
    }
    if (!(x > a && x < b)) x = split(a, b);
    if (!(x > a && x < b)) break; // a and b are adjacent numbers
    const f = polyval(c, x);
    if (f === 0) return x;
    if (f > 0 === aPositive) {
      a = x;
      fa = f;
      if (side === 1) fb /= 2;
      side = 1;
    } else {
      b = x;
      fb = f;
      if (side === -1) fa /= 2;
      side = -1;
    }
    if (b - a <= 4 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b))) break;
  }
  return a;
}

/**
 * A point inside (a, b) for a bisection step. Across zero it tries zero; over many orders of
 * magnitude it takes the geometric mean, so a bracket like [10⁻⁹, 10¹⁵] narrows in a few dozen
 * steps rather than a hundred.
 */
function split(a: number, b: number): number {
  if (a < 0 && b > 0) return 0;
  if (a > 0 && b > 1024 * a) return Math.sqrt(a) * Math.sqrt(b);
  if (b < 0 && a < 1024 * b) return -Math.sqrt(-a) * Math.sqrt(-b);
  return a + (b - a) / 2;
}

/**
 * The real roots of a polynomial of degree four or less within [lo, hi], in ascending order.
 * A root of even multiplicity, where the polynomial only touches zero, is found when the value at
 * the touching point rounds to exactly zero; otherwise it counts as no root, the same in every
 * browser.
 */
export function realRootsIn(coefficients: readonly number[], lo: number, hi: number): number[] {
  const c = trimmed(coefficients);
  const degree = c.length - 1;
  const roots: number[] = [];
  if (degree < 1 || !(hi >= lo)) return roots;
  if (degree === 1) {
    const x = -c[1]! / c[0]!;
    if (x >= lo && x <= hi) roots.push(x);
    return roots;
  }
  const breaks = [lo];
  for (const x of realRootsIn(derivative(c), lo, hi)) if (x > lo && x < hi) breaks.push(x);
  breaks.push(hi);
  let left = lo;
  let fLeft = polyval(c, left);
  if (fLeft === 0) roots.push(left);
  for (let i = 1; i < breaks.length; i++) {
    const right = breaks[i]!;
    let fRight = polyval(c, right);
    // A turning point within rounding noise of zero is a touching root.
    if (fRight !== 0 && i < breaks.length - 1 && nearZero(c, right, fRight)) fRight = 0;
    if (fRight === 0) {
      if (roots[roots.length - 1] !== right) roots.push(right);
    } else if (fLeft !== 0 && fLeft > 0 !== fRight > 0) {
      roots.push(solveBracket(c, left, right, fLeft, fRight));
    }
    left = right;
    fLeft = fRight;
  }
  return roots;
}

/**
 * The first time in (0, horizon] at which p falls from positive to zero: when a gap closes. p is a
 * squared distance minus the contact distance squared (or a signed distance), positive while apart.
 * If p is not positive at 0 the search starts once it has become positive. Returns the time just
 * before contact (p still positive there, by a few units in the last place), or Infinity.
 */
export function firstFall(coefficients: readonly number[], horizon: number): number {
  const c = trimmed(coefficients);
  const degree = c.length - 1;
  if (degree < 1 || !(horizon > 0)) return Infinity;
  const breaks = [0];
  if (degree >= 2) {
    for (const x of realRootsIn(derivative(c), 0, horizon)) {
      if (x > 0 && x < horizon) breaks.push(x);
    }
  }
  breaks.push(horizon);
  let left = 0;
  let fLeft = polyval(c, 0);
  for (let i = 1; i < breaks.length; i++) {
    const right = breaks[i]!;
    const fRight = polyval(c, right);
    if (fLeft > 0 && fRight <= 0) {
      return fRight === 0 ? right : solveBracket(c, left, right, fLeft, fRight);
    }
    // A closest approach that touches within rounding noise is a (grazing) contact.
    if (fLeft > 0 && i < breaks.length - 1 && nearZero(c, right, fRight)) return right;
    left = right;
    fLeft = fRight;
  }
  return Infinity;
}
