/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * This file is part of Pool.
 *
 * Pool is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version. See the LICENSE file for the full terms.
 *
 * Translated and changed from pooltool (pooltool/physics/resolve/stronge_compliant.py),
 * Apache License 2.0; see NOTICE.md.
 */

// A ball meeting the cushion, as Stronge's compliant, frictional, inelastic collision: during the
// contact the cushion acts as a pair of springs, one along the normal and one along the surface,
// and the contact point may slip, stick, and slip again. Given the normal and tangential speeds of
// the contact point as it arrives, it returns them as it leaves. The outcome depends only on the
// friction, the restitution and the ratio of the two springs' frequencies.
//
// Changes from pooltool: trigonometry comes from dmath; the slip time is found with a
// deterministic bracketed solver instead of scipy's TOMS 748; where pooltool would stop on a
// failed assertion (an input outside the model's range), this falls back to the gross-slip
// result, so every input has a well-defined answer. `fallbacks` counts those, for the tests.

import { acos, cos, PI, sin } from '../dmath.ts';

export const strongeStats = { fallbacks: 0 };

const isclose = (a: number, b: number) => Math.abs(a - b) <= 1e-8 + 1e-5 * Math.abs(b);

const tcShift = (e: number) => (PI / 2) * (1 - 1 / e);

/** Phase angle of the normal oscillation during restitution. */
const phaseRestitution = (t: number, wn: number, e: number) =>
  (wn * t) / e + (PI / 2) * (1 - 1 / e);

function vtStick(t: number, wt: number, vt0: number, ut0 = 0, tStick = 0): number {
  return wt * ut0 * sin(wt * (t - tStick)) + vt0 * cos(wt * (t - tStick));
}

function utInitialSlip(
  t: number,
  tc: number,
  vn0: number,
  mu: number,
  eta2: number,
  wn: number,
  e: number,
): number {
  const angle = t <= tc ? wn * t : phaseRestitution(t, wn, e);
  return ((-mu * vn0 * eta2) / wn) * sin(angle);
}

function vtInitialSlip(
  t: number,
  tc: number,
  vt0: number,
  vn0: number,
  mu: number,
  bt: number,
  wn: number,
  e: number,
): number {
  const c = t <= tc ? cos(wn * t) : e * cos(phaseRestitution(t, wn, e));
  return vt0 - mu * bt * vn0 * (1 - c);
}

/** A root of f on [a, b], where f(a) and f(b) differ in sign; NaN if they do not. */
function bracketRoot(f: (t: number) => number, a: number, b: number): number {
  let fa = f(a);
  const fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa > 0 === fb > 0) return NaN;
  for (let i = 0; i < 200; i++) {
    const m = a + (b - a) / 2;
    if (!(m > a && m < b)) break;
    const fm = f(m);
    if (fm === 0) return m;
    if (fm > 0 === fa > 0) {
      a = m;
      fa = fm;
    } else {
      b = m;
    }
  }
  return a + (b - a) / 2;
}

/**
 * The contact point's final tangential and normal speeds. Requires vt0 ≤ 0 and vn0 < 0 (moving
 * into the cushion, with the tangent chosen against the sliding). m is the ball's mass, beta_t and
 * beta_n the inverse inertia coefficients (3.5 and 1 for a sphere on a half space), kn the normal
 * stiffness (it sets only the contact's duration), eta2 = (β_t/β_n) / (ω_t/ω_n)².
 */
export function resolveCompliant(
  vt0: number,
  vn0: number,
  m: number,
  betaT: number,
  betaN: number,
  mu: number,
  e: number,
  kn: number,
  eta2: number,
): [vtf: number, vnf: number] {
  const bt = betaT / betaN;
  const ratio = vt0 / vn0;
  const wn = Math.sqrt((betaN * kn) / m);
  const wt = wn * Math.sqrt(bt / eta2);
  const tc = PI / (2 * wn);
  const tf = (1 + e) * tc;
  const grossSlip = vt0 - mu * vn0 * bt * (1 + e);
  // The normal speed comes back reversed and scaled by e: cos(phase) is exactly −1 at the end of
  // restitution, which pooltool evaluates numerically; this takes the exact value.
  const vnf = -e * vn0;

  if (ratio > mu * ((1 + e) * bt - eta2 / e)) return [grossSlip, vnf];

  if (ratio < mu * eta2) {
    // Sticks at first, then slips during restitution.
    let tSlip: number;
    if (isclose(ratio, 0)) tSlip = tf;
    else if (isclose(ratio, mu * eta2)) tSlip = tc;
    else {
      tSlip = bracketRoot(
        (t) =>
          Math.abs(-ratio * sin(wt * t)) -
          ((mu * eta2 * wt) / wn) * sin(phaseRestitution(t, wn, e)),
        tc,
        tf,
      );
      if (!(tSlip >= tc && tSlip <= tf)) {
        strongeStats.fallbacks++;
        return [grossSlip, vnf];
      }
    }
    const vtAtSlip = vtStick(tSlip, wt, vt0);
    return [vtAtSlip + mu * vn0 * bt * e * (1 + cos((wn * tSlip) / e + tcShift(e))), vnf];
  }

  // Slips at first, sticks, then slips again.
  const nd = nondimensionalStickTime(ratio, bt, mu, e, eta2);
  if (Number.isNaN(nd)) {
    strongeStats.fallbacks++;
    return [grossSlip, vnf];
  }
  const tStick = tc * nd;
  const utAtStick = utInitialSlip(tStick, tc, vn0, mu, eta2, wn, e);
  const vtAtStick = vtInitialSlip(tStick, tc, vt0, vn0, mu, bt, wn, e);
  let tSlip: number;
  if (isclose(ratio, mu * eta2)) tSlip = tc;
  else if (isclose(ratio, mu * ((1 + e) * bt - eta2 / e))) tSlip = tf;
  else {
    tSlip = bracketRoot(
      (t) =>
        Math.abs(
          (wn / (mu * vn0)) *
            (utAtStick * cos(wt * (t - tStick)) - (vtAtStick / wt) * sin(wt * (t - tStick))),
        ) -
        eta2 * sin(phaseRestitution(t, wn, e)),
      tc,
      tf,
    );
    if (!(tSlip >= tStick && tSlip <= tf)) {
      strongeStats.fallbacks++;
      return [grossSlip, vnf];
    }
  }
  const vtAtSlip = vtStick(tSlip, wt, vtAtStick, utAtStick, tStick);
  return [vtAtSlip + bt * mu * vn0 * e * (1 + cos(phaseRestitution(tSlip, wn, e))), vnf];
}

/** When the contact stops slipping, as a fraction of the compression time; NaN out of range. */
function nondimensionalStickTime(
  ratio: number,
  bt: number,
  mu: number,
  e: number,
  eta2: number,
): number {
  if (!(mu * eta2 <= ratio && ratio <= mu * ((1 + e) * bt - eta2 / e))) return NaN;
  if (ratio <= mu * bt) {
    const x = (ratio / mu - bt) / (eta2 - bt);
    if (!(x >= -1 && x <= 1)) return NaN;
    const result = (2 / PI) * acos(x);
    return result >= 0 && result <= 1 ? result : NaN;
  }
  const x = (ratio / mu - bt) / (eta2 / e - e * bt);
  if (!(x >= -1 && x <= 1)) return NaN;
  const result = (2 / PI) * (acos(x) - tcShift(e)) * e;
  return result >= 1 && result <= 1 + e ? result : NaN;
}
