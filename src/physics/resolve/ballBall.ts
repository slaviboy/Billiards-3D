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
 * Translated and changed from pooltool (pooltool/physics/resolve/ball_ball/core.py,
 * pooltool/physics/resolve/ball_ball/frictional_inelastic/__init__.py,
 * pooltool/physics/resolve/ball_ball/friction.py), Apache License 2.0; see NOTICE.md.
 */

// Two balls meeting, as pooltool's frictional inelastic model (after Dr. Dave Alciatore's technical
// proofs A-5, A-6 and A-14). Along the line of centres the balls exchange momentum with
// restitution e: the struck ball takes (1+e)/2 of the striker's normal speed. Across it, friction
// between the balls' surfaces transfers a little momentum and spin (the "throw" of cut shots):
// μ·|Δv_n| against the surfaces' relative slip, or, if that would reverse the slip, just enough to
// stop it. Both balls leave sliding.
//
// pooltool rotates into the line-of-centres frame with trigonometry; this uses the unit vector of
// the line of centres directly.

import { exp } from '../dmath.ts';
import {
  BALL_BALL_FRICTION,
  type BallParams,
  type BallState,
  EPS,
  Motion,
  MIN_DIST,
} from '../state.ts';
import { smallestRoot } from './cushion.ts';

/** Resolves a collision of two balls, in place. Returns the normal speed of approach. */
export function hitBalls(b1: BallState, b2: BallState, p: BallParams): number {
  kiss(b1, b2, p);
  const R = p.R;

  // The line of centres, and the frame (x along it, y across it, z up).
  let nx = b2.rx - b1.rx;
  let ny = b2.ry - b1.ry;
  const nl = Math.sqrt(nx * nx + ny * ny);
  nx /= nl;
  ny /= nl;
  const toX = (x: number, y: number) => x * nx + y * ny;
  const toY = (x: number, y: number) => -x * ny + y * nx;

  // Friction from the surfaces' relative speed across the line of centres (Alciatore's fit).
  const mu = friction(b1, b2, nx, ny, R);
  const e = p.eb;

  // In the collision frame.
  const v1 = [toX(b1.vx, b1.vy), toY(b1.vx, b1.vy), b1.vz];
  const w1 = [toX(b1.wx, b1.wy), toY(b1.wx, b1.wy), b1.wz];
  const v2 = [toX(b2.vx, b2.vy), toY(b2.vx, b2.vy), b2.vz];
  const w2 = [toX(b2.wx, b2.wy), toY(b2.wx, b2.wy), b2.wz];
  const approach = v1[0]! - v2[0]!;

  const v1nf = 0.5 * ((1 - e) * v1[0]! + (1 + e) * v2[0]!);
  const v2nf = 0.5 * ((1 + e) * v1[0]! + (1 - e) * v2[0]!);
  const dvn = Math.abs(v2nf - v1nf);
  const w1n = w1[0]!;
  const w2n = w2[0]!;
  v1[0] = v2[0] = w1[0] = w2[0] = 0;

  // Contact-point velocities: ball 1's surface at +R x̂, ball 2's at −R x̂.
  // v + ω × (R x̂) = (vx, vy + R ωz, vz − R ωy)
  const slip = (a: number[], wa: number[], b: number[], wb: number[]) => [
    a[0]! - b[0]!,
    a[1]! + R * wa[2]! - (b[1]! - R * wb[2]!),
    a[2]! - R * wa[1]! - (b[2]! + R * wb[1]!),
  ];
  const s0 = slip(v1, w1, v2, w2);
  const s0l = Math.sqrt(s0[0]! * s0[0]! + s0[1]! * s0[1]! + s0[2]! * s0[2]!);

  let f1v = v1;
  let f1w = w1;
  let f2v = v2;
  let f2w = w2;
  let slipping = false;
  if (s0l > EPS) {
    // Δv₁ = μ|Δv_n|·(−ŝ); Δω = (5/2R)·(x̂ × Δv₁), x̂ × d = (0, −d_z, d_y)
    const k = (mu * dvn) / s0l;
    const d = [-k * s0[0]!, -k * s0[1]!, -k * s0[2]!];
    const dw = [0, (-2.5 / R) * d[2]!, (2.5 / R) * d[1]!];
    f1v = add(v1, d, 1);
    f1w = add(w1, dw, 1);
    f2v = add(v2, d, -1);
    f2w = add(w2, dw, 1);
    const s1 = slip(f1v, f1w, f2v, f2w);
    slipping = s0[0]! * s1[0]! + s0[1]! * s1[1]! + s0[2]! * s1[2]! > 0;
  }
  if (!slipping) {
    // No slip at the end: Δv₁ = −(1/7)(v₁ − v₂ + R(ω₁ + ω₂) × x̂), (ω × x̂ = (0, ωz, −ωy));
    // Δω = −(5/14)((x̂ × (v₁ − v₂))/R + ω₁ + ω₂).
    const dv = [v1[0]! - v2[0]!, v1[1]! - v2[1]!, v1[2]! - v2[2]!];
    const ws = [w1[0]! + w2[0]!, w1[1]! + w2[1]!, w1[2]! + w2[2]!];
    const d = [
      -(1 / 7) * dv[0]!,
      -(1 / 7) * (dv[1]! + R * ws[2]!),
      -(1 / 7) * (dv[2]! - R * ws[1]!),
    ];
    const dw = [
      -(5 / 14) * ws[0]!,
      -(5 / 14) * (-dv[2]! / R + ws[1]!),
      -(5 / 14) * (dv[1]! / R + ws[2]!),
    ];
    f1v = add(v1, d, 1);
    f1w = add(w1, dw, 1);
    f2v = add(v2, d, -1);
    f2w = add(w2, dw, 1);
  }
  f1v[0] = v1nf;
  f2v[0] = v2nf;
  f1w[0] = w1n;
  f2w[0] = w2n;

  // Back to the table frame; the balls stay on the cloth.
  const back = (b: BallState, v: number[], w: number[]) => {
    b.vx = v[0]! * nx - v[1]! * ny;
    b.vy = v[0]! * ny + v[1]! * nx;
    b.vz = 0;
    b.wx = w[0]! * nx - w[1]! * ny;
    b.wy = w[0]! * ny + w[1]! * nx;
    b.wz = w[2]!;
    b.s = Motion.Sliding;
  };
  back(b1, f1v, f1w);
  back(b2, f2v, f2w);
  continuallyTouching(b1, b2);
  return approach;
}

function add(a: number[], d: number[], k: number): number[] {
  return [a[0]! + k * d[0]!, a[1]! + k * d[1]!, a[2]! + k * d[2]!];
}

/** μ = a + b·e^(−c·v), v the surfaces' relative speed tangent to the contact. */
function friction(b1: BallState, b2: BallState, nx: number, ny: number, R: number): number {
  // Tangent part of v plus ω × (R n) for ball 1, and with −n for ball 2.
  const tangent = (b: BallState, sx: number, sy: number) => {
    const vn = b.vx * sx + b.vy * sy;
    // ω × (R s), s = (sx, sy, 0)
    return [
      b.vx - vn * sx + (b.wy * 0 - b.wz * R * sy),
      b.vy - vn * sy + (b.wz * R * sx - b.wx * 0),
      b.vz + (b.wx * R * sy - b.wy * R * sx),
    ];
  };
  const a = tangent(b1, nx, ny);
  const c = tangent(b2, -nx, -ny);
  const dx = a[0]! - c[0]!;
  const dy = a[1]! - c[1]!;
  const dz = a[2]! - c[2]!;
  const v = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return BALL_BALL_FRICTION.a + BALL_BALL_FRICTION.b * exp(-BALL_BALL_FRICTION.c * v);
}

/** Moves the balls along their velocities until their centres are 2R + MIN_DIST apart. */
function kiss(b1: BallState, b2: BallState, p: BallParams): void {
  const target = 2 * p.R + MIN_DIST;
  const still = (b: BallState) => b.s !== Motion.Sliding && b.s !== Motion.Rolling;
  if (!(still(b1) && still(b2))) {
    const bx = b2.vx - b1.vx;
    const by = b2.vy - b1.vy;
    const bz = b2.vz - b1.vz;
    const cx = b2.rx - b1.rx;
    const cy = b2.ry - b1.ry;
    const cz = b2.rz - b1.rz;
    const t = smallestRoot(
      bx * bx + by * by + bz * bz,
      2 * bx * cx + 2 * by * cy + 2 * bz * cz,
      cx * cx + cy * cy + cz * cz - target * target,
    );
    if (t === t) {
      const r1x = b1.rx + t * b1.vx;
      const r1y = b1.ry + t * b1.vy;
      const r2x = b2.rx + t * b2.vx;
      const r2y = b2.ry + t * b2.vy;
      const mx = (r1x + r2x) / 2 - (b1.rx + b2.rx) / 2;
      const my = (r1y + r2y) / 2 - (b1.ry + b2.ry) / 2;
      if (Math.sqrt(mx * mx + my * my) <= 5 * MIN_DIST) {
        b1.rx = r1x;
        b1.ry = r1y;
        b2.rx = r2x;
        b2.ry = r2y;
        return;
      }
    }
  }
  // Apart along the line of centres, each half the correction.
  const dx = b2.rx - b1.rx;
  const dy = b2.ry - b1.ry;
  const d = Math.sqrt(dx * dx + dy * dy);
  const half = (target - d) / 2;
  b1.rx -= (half * dx) / d;
  b1.ry -= (half * dy) / d;
  b2.rx += (half * dx) / d;
  b2.ry += (half * dy) / d;
}

/**
 * Balls moving together along their line of centres (a frozen line struck end on) would collide
 * again microseconds later, endlessly. As pooltool does, the slower one takes a tenth of the faster
 * one's speed along the line, so they part.
 */
function continuallyTouching(b1: BallState, b2: BallState): void {
  const s1 = Math.sqrt(b1.vx * b1.vx + b1.vy * b1.vy + b1.vz * b1.vz);
  const s2 = Math.sqrt(b2.vx * b2.vx + b2.vy * b2.vy + b2.vz * b2.vz);
  if (!(s1 > 0 && s2 > 0)) return;
  let lx = b2.rx - b1.rx;
  let ly = b2.ry - b1.ry;
  const ll = Math.sqrt(lx * lx + ly * ly);
  lx /= ll;
  ly /= ll;
  const v1l = b1.vx * lx + b1.vy * ly;
  const v2l = b2.vx * lx + b2.vy * ly;
  const aligned = (b1.vx * b2.vx + b1.vy * b2.vy + b1.vz * b2.vz) / (s1 * s2) > 0.9;
  if (!(Math.abs(v2l - v1l) < 0.01 && aligned)) return;
  const stolen = (v1l > v2l ? v1l : v2l) * 0.1;
  const n1 = v1l > v2l ? v1l - stolen : v1l + stolen;
  const n2 = v1l > v2l ? v2l + stolen : v2l - stolen;
  b1.vx += (n1 - v1l) * lx;
  b1.vy += (n1 - v1l) * ly;
  b2.vx += (n2 - v2l) * lx;
  b2.vy += (n2 - v2l) * ly;
}
