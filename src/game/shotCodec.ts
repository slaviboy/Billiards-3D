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

// A shot as integers: what the shooter's controls produce, what travels to the other player, and
// what both players' simulations start from. Integers mean nothing is lost or reinterpreted on the
// way, and decoding them uses only deterministic arithmetic, so both sides strike the same ball.

import { cos, PI, sin } from '../physics/dmath.ts';
import type { Strike } from '../physics/resolve/stick.ts';
import type { PocketId } from '../physics/types.ts';

/** Steps of a full turn of aim. */
export const YAW_STEPS = 1 << 20;
/** Cue elevation in tenths of a degree, up to 60°. */
export const MAX_PITCH = 600;
/** Cue speed in millimetres per second. */
export const MIN_SPEED = 50;
export const MAX_SPEED = 8000;
/** Tip offset from the ball's centre, in thousandths of the radius; at most half the radius. */
export const MAX_OFFSET = 500;
/** Placement in units of 10 µm. */
export const POSITION_UNIT = 1e-5;

export interface ShotCode {
  /** Aim heading on the table, 0 … YAW_STEPS − 1 (0 along +x, counter-clockwise). */
  readonly yaw: number;
  /** Cue elevation, 0 … MAX_PITCH tenths of a degree. */
  readonly pitch: number;
  /** Cue speed, MIN_SPEED … MAX_SPEED mm/s. */
  readonly speed: number;
  /** Tip offset across (positive: left of centre as the shooter sees it) and up, ×1000/R. */
  readonly a: number;
  readonly b: number;
}

export interface Placement {
  readonly x: number;
  readonly y: number;
}

const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** Whether a received shot code has every field present, whole and in range. */
export function isShotCode(value: unknown): value is ShotCode {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isInt(v.yaw, 0, YAW_STEPS - 1) &&
    isInt(v.pitch, 0, MAX_PITCH) &&
    isInt(v.speed, MIN_SPEED, MAX_SPEED) &&
    isInt(v.a, -MAX_OFFSET, MAX_OFFSET) &&
    isInt(v.b, -MAX_OFFSET, MAX_OFFSET) &&
    (v.a as number) * (v.a as number) + (v.b as number) * (v.b as number) <= MAX_OFFSET * MAX_OFFSET
  );
}

export function isPocketId(value: unknown): value is PocketId {
  return isInt(value, 0, 5);
}

/** The physics' strike, decoded from the code (the same bits on every computer). */
export function decodeShot(code: ShotCode, ball = 0): Strike {
  const phi = (code.yaw * (2 * PI)) / YAW_STEPS;
  const theta = (code.pitch * PI) / 1800;
  return {
    ball,
    V0: code.speed / 1000,
    cosPhi: cos(phi),
    sinPhi: sin(phi),
    cosTheta: cos(theta),
    sinTheta: sin(theta),
    a: code.a / 1000,
    b: code.b / 1000,
  };
}

/**
 * The code nearest to the shooter's controls: heading in radians, elevation in degrees, cue speed
 * in m/s, tip offset in units of R (clamped to the miscue limit).
 */
export function encodeShot(
  heading: number,
  elevation: number,
  speed: number,
  a: number,
  b: number,
): ShotCode {
  const turn = heading / (2 * PI);
  let yaw = Math.round((turn - Math.floor(turn)) * YAW_STEPS);
  if (yaw >= YAW_STEPS) yaw -= YAW_STEPS;
  let ia = Math.round(a * 1000);
  let ib = Math.round(b * 1000);
  const r = Math.sqrt(ia * ia + ib * ib);
  if (r > MAX_OFFSET) {
    ia = Math.trunc((ia * MAX_OFFSET) / r);
    ib = Math.trunc((ib * MAX_OFFSET) / r);
  }
  return {
    yaw,
    pitch: Math.min(MAX_PITCH, Math.max(0, Math.round(elevation * 10))),
    speed: Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed * 1000))),
    a: ia,
    b: ib,
  };
}

/** A cue ball placement as integers, and back. */
export function encodePlacement(x: number, y: number): Placement {
  return { x: Math.round(x / POSITION_UNIT), y: Math.round(y / POSITION_UNIT) };
}

export function decodePlacement(p: Placement): { x: number; y: number } {
  return { x: p.x * POSITION_UNIT, y: p.y * POSITION_UNIT };
}
