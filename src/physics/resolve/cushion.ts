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
 * Translated and changed from pooltool (pooltool/physics/resolve/ball_cushion/core.py,
 * pooltool/physics/resolve/ball_cushion/stronge_compliant/model.py,
 * pooltool/objects/table/components.py), Apache License 2.0; see NOTICE.md.
 */

// A ball meeting a cushion (a straight nose or a pocket's rounded lip): first set it exactly
// MIN_DIST from the cushion, then resolve the impact at the contact point. The cushion touches the
// ball above its equator (the nose is at 63.5 % of the ball's height), so the contact normal points
// from the nose line down to the ball's centre; the impulse along it both bounces the ball and
// changes its spin.

import type { CircularCushion, LinearCushion } from '../types.ts';
import {
  type BallParams,
  type BallState,
  CUSHION_OMEGA_RATIO,
  Motion,
  MIN_DIST,
} from '../state.ts';
import { resolveCompliant } from './stronge.ts';

const BETA_T = 3.5;
const BETA_N = 1;

/** Resolves a ball hitting a straight cushion, in place. Returns the normal speed of impact. */
export function hitLinear(b: BallState, c: LinearCushion, p: BallParams): number {
  kissLinear(b, c, p);
  // Normal from the nose line (at height h) to the ball's centre, perpendicular to the line.
  const ax = c.p2x - c.p1x;
  const ay = c.p2y - c.p1y;
  const al = Math.sqrt(ax * ax + ay * ay);
  const ux = ax / al;
  const uy = ay / al;
  const rx = b.rx - c.p1x;
  const ry = b.ry - c.p1y;
  const rz = b.rz - c.h;
  const along = rx * ux + ry * uy;
  return compliant(b, rx - along * ux, ry - along * uy, rz, p);
}

/** Resolves a ball hitting a pocket's lip circle, in place. Returns the normal speed of impact. */
export function hitCircular(b: BallState, c: CircularCushion, p: BallParams): number {
  kissCircular(b, c, p);
  return compliant(b, b.rx - c.cx, b.ry - c.cy, b.rz - c.h, p);
}

/** The Stronge compliant impact along the (unnormalised) contact normal (nx, ny, nz). */
function compliant(b: BallState, nx: number, ny: number, nz: number, p: BallParams): number {
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
  nx /= nl;
  ny /= nl;
  nz /= nl;
  const R = p.R;
  // Velocity of the ball's surface at the contact point, which is at −R·n from the centre:
  // v + ω × (−R n).
  const vcx = b.vx + (b.wy * -R * nz - b.wz * -R * ny);
  const vcy = b.vy + (b.wz * -R * nx - b.wx * -R * nz);
  const vcz = b.vz + (b.wx * -R * ny - b.wy * -R * nx);
  const vn0 = nx * vcx + ny * vcy + nz * vcz;
  // Moving away or along (a graze decided by rounding): no impulse.
  if (!(vn0 < 0)) {
    b.s = Motion.Sliding;
    return 0;
  }
  // Tangential part, with the tangent pointing against it (pooltool's flipped decomposition).
  const cx = ny * vcz - nz * vcy;
  const cy = nz * vcx - nx * vcz;
  const cz = nx * vcy - ny * vcx;
  const tl = Math.sqrt(cx * cx + cy * cy + cz * cz);
  const vt0 = -tl;
  let tx = 0;
  let ty = 0;
  let tz = 0;
  if (tl !== 0) {
    // (n × v) × n / v_t
    tx = (cy * nz - cz * ny) / vt0;
    ty = (cz * nx - cx * nz) / vt0;
    tz = (cx * ny - cy * nx) / vt0;
  }
  const eta2 = BETA_T / BETA_N / (CUSHION_OMEGA_RATIO * CUSHION_OMEGA_RATIO);
  const [vtf, vnf] = resolveCompliant(vt0, vn0, p.m, BETA_T, BETA_N, p.fc, p.ec, 1e3, eta2);
  const dvn = (vnf - vn0) / BETA_N;
  const dvt = (vtf - vt0) / BETA_T;
  b.vx += dvn * nx + dvt * tx;
  b.vy += dvn * ny + dvt * ty;
  b.vz += dvn * nz + dvt * tz;
  // ω += (5/2R) · (−n × Δv_t)
  const k = 2.5 / R;
  const dx = dvt * tx;
  const dy = dvt * ty;
  const dz = dvt * tz;
  b.wx += k * -(ny * dz - nz * dy);
  b.wy += k * -(nz * dx - nx * dz);
  b.wz += k * -(nx * dy - ny * dx);
  // The ball stays on the cloth.
  b.vz = 0;
  b.s = Motion.Sliding;
  return -vn0;
}

/** Moves the ball along its velocity until it is R + MIN_DIST from the cushion's line. */
function kissLinear(b: BallState, c: LinearCushion, p: BallParams): void {
  const target = p.R + MIN_DIST;
  const translating = b.s === Motion.Sliding || b.s === Motion.Rolling;
  if (translating) {
    let nx = c.nx;
    let ny = c.ny;
    if (nx * b.vx + ny * b.vy <= 0) {
      nx = -nx;
      ny = -ny;
    }
    const d0 = (b.rx - c.p1x) * nx + (b.ry - c.p1y) * ny;
    const vn = b.vx * nx + b.vy * ny;
    const t1 = (target - d0) / vn;
    const t2 = (-target - d0) / vn;
    const t = Math.abs(t1) < Math.abs(t2) ? t1 : t2;
    const shift = Math.abs(t) * Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (shift <= 5 * MIN_DIST) {
      b.rx += t * b.vx;
      b.ry += t * b.vy;
      return;
    }
  }
  // Along the line's normal from its closest point.
  const ax = c.p2x - c.p1x;
  const ay = c.p2y - c.p1y;
  const s = ((b.rx - c.p1x) * ax + (b.ry - c.p1y) * ay) / (ax * ax + ay * ay);
  const qx = c.p1x + s * ax;
  const qy = c.p1y + s * ay;
  const dx = b.rx - qx;
  const dy = b.ry - qy;
  const d = Math.sqrt(dx * dx + dy * dy);
  b.rx = qx + (target * dx) / d;
  b.ry = qy + (target * dy) / d;
}

/** Moves the ball along its velocity until it is R + r + MIN_DIST from the circle's centre. */
function kissCircular(b: BallState, c: CircularCushion, p: BallParams): void {
  const target = p.R + c.r + MIN_DIST;
  const dx = b.rx - c.cx;
  const dy = b.ry - c.cy;
  const translating = b.s === Motion.Sliding || b.s === Motion.Rolling;
  if (translating) {
    const t = smallestRoot(
      b.vx * b.vx + b.vy * b.vy,
      2 * (dx * b.vx + dy * b.vy),
      dx * dx + dy * dy - target * target,
    );
    if (t === t && Math.abs(t) * Math.sqrt(b.vx * b.vx + b.vy * b.vy) <= 5 * MIN_DIST) {
      b.rx += t * b.vx;
      b.ry += t * b.vy;
      return;
    }
  }
  const d = Math.sqrt(dx * dx + dy * dy);
  b.rx = c.cx + (target * dx) / d;
  b.ry = c.cy + (target * dy) / d;
}

/**
 * The real root of a·t² + b·t + c = 0 nearest zero, the way pooltool's make_kiss chooses it
 * (cancellation-free form; roots counted real when their imaginary part is under 1e-3 of their
 * real part). NaN when there is none.
 */
export function smallestRoot(a: number, b: number, c: number): number {
  if (a === 0) return b === 0 ? NaN : -c / b;
  const d = b * b - 4 * a * c;
  if (d < 0) {
    // Complex pair −b/2a ± i·√(−d)/2a: real enough only if the imaginary part is tiny.
    const re = -b / (2 * a);
    const im = Math.sqrt(-d) / (2 * Math.abs(a));
    return im / Math.abs(re) < 1e-3 ? re : NaN;
  }
  const sq = Math.sqrt(d);
  const sign = b >= 0 ? 1 : -1;
  let num = -b - sign * sq;
  if (Math.abs(num) < 1e-14 * Math.abs(2 * a)) num = -b + sign * sq;
  const r1 = num / (2 * a);
  const r2 = Math.abs(r1) < 1e-14 ? (-b + sq) / (2 * a) : c / a / r1;
  return Math.abs(r1) <= Math.abs(r2) ? r1 : r2;
}
