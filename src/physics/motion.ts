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
 * Translated and changed from pooltool (pooltool/physics/evolve/__init__.py,
 * pooltool/ptmath/utils.py), Apache License 2.0; see NOTICE.md.
 */

// How a ball moves between events, in closed form (pooltool's equations, after Marlow and the
// pooltool theory notes):
//
//   sliding  the contact point slips with velocity u = v + ω × (−R ẑ). Friction μs·m·g opposes it,
//            so its direction û stays fixed while the slip shrinks at (7/2)·μs·g:
//              r = r₀ + v₀t − ½μs·g·t²·û,   v = v₀ − μs·g·t·û,   ω_xy = ω₀ − (5μs·g/2R)·t·(û × ẑ)
//   rolling  no slip; rolling resistance slows it along its path:
//              r = r₀ + v₀t − ½μr·g·t²·v̂,   v = v₀ − μr·g·t·v̂,   ω_xy = (−v_y, v_x)/R
//   spin     about the vertical, in every state, decays linearly at 5μsp·g/2R, down to zero.
//
// pooltool rotates into the ball's frame with trigonometry; this works with the unit vectors
// directly, which needs only square roots (and so stays deterministic).

import type { BallParams, BallState } from './state.ts';
import { EPS, Motion } from './state.ts';

/** |u|, the speed of the contact point over the cloth. */
export function slipSpeed(b: Readonly<BallState>, R: number): number {
  const ux = b.vx - R * b.wy;
  const uy = b.vy + R * b.wx;
  return Math.sqrt(ux * ux + uy * uy + b.vz * b.vz);
}

export function speed(b: Readonly<BallState>): number {
  return Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
}

/** Time until a sliding ball's slip vanishes (pooltool get_slide_time). */
export function slideTime(b: Readonly<BallState>, p: BallParams): number {
  return (2 * slipSpeed(b, p.R)) / (7 * p.us * p.g);
}

/** Time until a rolling ball stops translating (pooltool get_roll_time). */
export function rollTime(b: Readonly<BallState>, p: BallParams): number {
  return speed(b) / (p.ur * p.g);
}

/** Time until the vertical spin is gone (pooltool get_spin_time). */
export function spinTime(b: Readonly<BallState>, p: BallParams): number {
  return (((Math.abs(b.wz) * 2) / 5) * p.R) / p.usp / p.g;
}

/** Kinetic energy, translational and rotational (pooltool get_ball_energy). */
export function energy(b: Readonly<BallState>, p: BallParams): number {
  const v2 = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz;
  const w2 = b.wx * b.wx + b.wy * b.wy + b.wz * b.wz;
  return (p.m * v2) / 2 + ((2 / 5) * p.m * p.R * p.R * w2) / 2;
}

/** The vertical spin after `t` more seconds of decay. */
function decaySpin(wz: number, t: number, p: BallParams): number {
  if (t === 0 || Math.abs(wz) < EPS) return wz;
  const alpha = (5 * p.usp * p.g) / (2 * p.R);
  const stop = Math.abs(wz) / alpha;
  const dt = t > stop ? stop : t;
  return wz > 0 ? wz - alpha * dt : wz + alpha * dt;
}

/**
 * The state `dt` seconds on, within the ball's current motion state (the caller never steps past
 * the ball's next transition), written into `out` (which may be `b`). Time is not changed.
 */
export function evolve(b: Readonly<BallState>, dt: number, p: BallParams, out: BallState): void {
  const s = b.s;
  if (s === Motion.Stationary || s === Motion.Pocketed || dt === 0) {
    if (out !== b) copyInto(out, b);
    return;
  }
  if (s === Motion.Spinning) {
    if (out !== b) copyInto(out, b);
    out.wz = decaySpin(b.wz, dt, p);
    return;
  }
  const { rx, ry, rz, vx, vy, vz, wx, wy, wz } = b;
  if (s === Motion.Sliding) {
    let ux = vx - p.R * wy;
    let uy = vy + p.R * wx;
    const u = Math.sqrt(ux * ux + uy * uy);
    if (u > 0) {
      ux /= u;
      uy /= u;
    }
    const k = p.us * p.g;
    const half = 0.5 * k * dt * dt;
    out.rx = rx + vx * dt - half * ux;
    out.ry = ry + vy * dt - half * uy;
    out.rz = rz;
    out.vx = vx - k * dt * ux;
    out.vy = vy - k * dt * uy;
    out.vz = vz;
    // ω_xy − (5μs·g/2R)·t·(û × ẑ), with û × ẑ = (u_y, −u_x, 0).
    const kw = (5 / 2 / p.R) * k * dt;
    out.wx = wx - kw * uy;
    out.wy = wy + kw * ux;
    out.wz = decaySpin(wz, dt, p);
  } else {
    const v = Math.sqrt(vx * vx + vy * vy);
    const hx = v > 0 ? vx / v : 0;
    const hy = v > 0 ? vy / v : 0;
    const k = p.ur * p.g;
    const half = 0.5 * k * dt * dt;
    out.rx = rx + vx * dt - half * hx;
    out.ry = ry + vy * dt - half * hy;
    out.rz = rz;
    const nvx = vx - k * dt * hx;
    const nvy = vy - k * dt * hy;
    out.vx = nvx;
    out.vy = nvy;
    out.vz = vz;
    out.wx = -nvy / p.R;
    out.wy = nvx / p.R;
    out.wz = decaySpin(wz, dt, p);
  }
  out.s = s;
  out.t = b.t;
}

function copyInto(out: BallState, b: Readonly<BallState>): void {
  out.rx = b.rx;
  out.ry = b.ry;
  out.rz = b.rz;
  out.vx = b.vx;
  out.vy = b.vy;
  out.vz = b.vz;
  out.wx = b.wx;
  out.wy = b.wy;
  out.wz = b.wz;
  out.s = b.s;
  out.t = b.t;
}

/**
 * The ball's path as r(t) = c + b·t + a·t² in the plane, until its next transition: written into
 * `out` as [ax, ay, bx, by, cx, cy]. Zero motion for a ball that does not translate.
 */
export function trajectory(b: Readonly<BallState>, p: BallParams, out: Float64Array): void {
  out[4] = b.rx;
  out[5] = b.ry;
  if (b.s !== Motion.Sliding && b.s !== Motion.Rolling) {
    out[0] = out[1] = out[2] = out[3] = 0;
    return;
  }
  out[2] = b.vx;
  out[3] = b.vy;
  // pooltool's get_u: the slip direction while sliding, the velocity's while rolling (or while
  // sliding with no slip, for the instant before the transition).
  let dx = 0;
  let dy = 0;
  let mu = p.ur;
  if (b.s === Motion.Sliding) {
    mu = p.us;
    dx = b.vx - p.R * b.wy;
    dy = b.vy + p.R * b.wx;
  }
  if (dx === 0 && dy === 0) {
    dx = b.vx;
    dy = b.vy;
  }
  const n = Math.sqrt(dx * dx + dy * dy);
  const k = n > 0 ? (-0.5 * mu * p.g) / n : 0;
  out[0] = k * dx;
  out[1] = k * dy;
}
