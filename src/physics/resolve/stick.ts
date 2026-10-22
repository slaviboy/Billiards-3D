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
 * Translated and changed from pooltool
 * (pooltool/physics/resolve/stick_ball/instantaneous_point/__init__.py,
 * pooltool/physics/resolve/stick_ball/squirt.py), Apache License 2.0; see NOTICE.md.
 */

// The cue striking the cue ball: an instantaneous impulse at a point of the ball (Dr. Dave
// Alciatore's technical proof A-30, as pooltool models it). The cue arrives at speed V0, aimed at
// heading φ on the table and tilted down by θ; the tip meets the ball at offset (a, b) from its
// centre, in units of R: a to the side (positive right), b up (positive above centre, follow).
// The impulse gives the ball speed v = 2·V0 / (1 + m/M + (offset terms)/(2R²/5)) and a spin from
// where it lands; side spin also makes the ball squirt away from the aim line (TP A-31), more the
// lighter the cue's end.
//
// The angles arrive as their cosines and sines (decoded once, deterministically, from the shot's
// integers), so nothing here needs trigonometry.

import type { BallParams, BallState, CueParams } from '../state.ts';
import { Motion } from '../state.ts';

export interface Strike {
  /** Which ball the cue strikes (the cue ball). */
  readonly ball: number;
  /** Cue speed at impact, m/s. */
  readonly V0: number;
  /** The aim heading φ: the direction the cue points, on the table. */
  readonly cosPhi: number;
  readonly sinPhi: number;
  /** The cue's elevation θ above the horizontal. */
  readonly cosTheta: number;
  readonly sinTheta: number;
  /** Contact offset from the ball's centre, in units of R (a² + b² < 1). */
  readonly a: number;
  readonly b: number;
}

/** Applies the strike to the ball, in place: it leaves sliding. */
export function strike(ball: BallState, s: Strike, p: BallParams, cue: CueParams): void {
  const { m, R } = p;
  const ct = s.cosTheta;
  const st = s.sinTheta;
  // The contact point on the ball, with the cue's tilt applied.
  const cueC = Math.sqrt(1 - s.a * s.a - s.b * s.b);
  const ballA = s.a;
  const ballC = ct * cueC - st * s.b;
  const ballB = st * cueC + ct * s.b;
  const a = R * ballA;
  const c = R * ballC;
  const b = R * ballB;

  const I = (2 / 5) * R * R;
  const bc = b * ct;
  const cs = c * st;
  const temp = a * a + bc * bc + cs * cs - 2 * b * c * ct * st;
  const v = (2 * s.V0) / (1 + m / cue.M + temp / I);

  // In the ball's frame the ball leaves along −y; rotate by φ + 90°, whose cosine is −sin φ and
  // sine cos φ: (x, y) → (−x sin φ − y cos φ, x cos φ − y sin φ).
  const vbY = -v * ct;
  const wb = [(v / I) * (-c * st + b * ct), (v / I) * (a * st), (v / I) * (-a * ct)];
  const turn = (x: number, y: number): [number, number] => [
    -x * s.sinPhi - y * s.cosPhi,
    x * s.cosPhi - y * s.sinPhi,
  ];
  let [vx, vy] = turn(0, vbY);
  const [wx, wy] = turn(wb[0]!, wb[1]!);

  // Squirt: the velocity turns by α = −atan2(N, D), N = 2.5·a·√(1−a²), D = 1 + m/m_e + 2.5(1−a²).
  const A = 1 - ballA * ballA;
  const N = 2.5 * ballA * Math.sqrt(A);
  const D = 1 + m / cue.endMass + 2.5 * A;
  const len = Math.sqrt(N * N + D * D);
  const cosA = D / len;
  const sinA = -N / len;
  [vx, vy] = [vx * cosA - vy * sinA, vx * sinA + vy * cosA];

  ball.vx = vx;
  ball.vy = vy;
  ball.vz = 0;
  ball.wx = wx;
  ball.wy = wy;
  ball.wz = wb[2]!;
  ball.s = Motion.Sliding;
}
