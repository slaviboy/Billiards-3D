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
 * Translated and changed from pooltool (pooltool/constants.py, pooltool/objects/ball/params.py,
 * pooltool/objects/cue/datatypes.py), Apache License 2.0; see NOTICE.md.
 */

// A ball's state, the parameters of balls and cue, and the motion states.

/**
 * How a ball is moving. Sliding: the contact point slips over the cloth. Rolling: it does not.
 * Spinning: turning in place about the vertical. The numbers are pooltool's.
 */
export const Motion = {
  Stationary: 0,
  Spinning: 1,
  Sliding: 2,
  Rolling: 3,
  Pocketed: 4,
} as const;
export type Motion = (typeof Motion)[keyof typeof Motion];

/** pooltool's EPS: 100 × machine epsilon. */
export const EPS = Number.EPSILON * 100;
/** The gap left between balls (and between ball and cushion) after they touch, in metres. */
export const MIN_DIST = 1e-6;

/**
 * Position, velocity and angular velocity of a ball, in the table frame, and its motion state,
 * from time `t` on. The centre of a ball on the cloth is at z = R; velocities are horizontal.
 */
export interface BallState {
  rx: number;
  ry: number;
  rz: number;
  vx: number;
  vy: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
  s: Motion;
  t: number;
}

export function ballState(
  rx: number,
  ry: number,
  rz: number,
  s: Motion = Motion.Stationary,
  t = 0,
): BallState {
  return { rx, ry, rz, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, s, t };
}

export function copyState(b: Readonly<BallState>): BallState {
  return {
    rx: b.rx,
    ry: b.ry,
    rz: b.rz,
    vx: b.vx,
    vy: b.vy,
    vz: b.vz,
    wx: b.wx,
    wy: b.wy,
    wz: b.wz,
    s: b.s,
    t: b.t,
  };
}

export function assignState(to: BallState, from: Readonly<BallState>): void {
  to.rx = from.rx;
  to.ry = from.ry;
  to.rz = from.rz;
  to.vx = from.vx;
  to.vy = from.vy;
  to.vz = from.vz;
  to.wx = from.wx;
  to.wy = from.wy;
  to.wz = from.wz;
  to.s = from.s;
  to.t = from.t;
}

export const isTranslating = (s: Motion) => s === Motion.Sliding || s === Motion.Rolling;

/** Ball properties (pooltool's POOL_GENERIC). */
export interface BallParams {
  /** Mass, kg. */
  readonly m: number;
  /** Radius, m. */
  readonly R: number;
  /** Sliding friction between ball and cloth. */
  readonly us: number;
  /** Rolling resistance. */
  readonly ur: number;
  /** Spinning friction (pooltool's u_sp = u_sp_proportionality × R). */
  readonly usp: number;
  /** Ball-ball restitution. */
  readonly eb: number;
  /** Ball-cushion restitution and friction. */
  readonly ec: number;
  readonly fc: number;
  readonly g: number;
}

export const POOL_BALL: BallParams = {
  m: 0.170097,
  R: 0.028575,
  us: 0.2,
  ur: 0.01,
  usp: ((10 * 2) / 5 / 9) * 0.028575,
  eb: 0.95,
  ec: 0.85,
  fc: 0.2,
  g: 9.81,
};

/** The cue: its mass, and the effective mass of its end, which sets how far side spin squirts. */
export interface CueParams {
  readonly M: number;
  readonly endMass: number;
}

/** A 19 oz cue (pooltool's default is 20 oz); end mass as in pooltool, m/30. */
export const POOL_CUE: CueParams = {
  M: 0.539,
  endMass: 0.170097 / 30,
};

/** Ball-ball friction fit μ = a + b·e^(−c·v) (Alciatore, TP A-14; pooltool's default). */
export const BALL_BALL_FRICTION = { a: 0.009951, b: 0.108, c: 1.088 } as const;

/** Cushion stiffness ratio ω_t/ω_n of the Stronge compliant model (pooltool's default). */
export const CUSHION_OMEGA_RATIO = 1.8;

/** Where a pocketed ball rests: below the pocket's centre (pooltool's pocket depth). */
export const POCKET_DEPTH = 0.08;
