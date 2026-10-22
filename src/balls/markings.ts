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

// How each ball is marked (WPA equipment specification 16): balls 1–8 solid in their colours,
// 9–15 white with a band of colour around the middle, every number printed twice in a white disc,
// on opposite sides, one of the two upside down, and 6 and 9 underscored. The proportions of the
// disc and the band are measured on photographs (docs/visual-research.md, section 3).
//
// The markings are defined on the sphere, in the ball's own frame: the band runs around the
// equator (perpendicular to +Y) and the two discs sit on it at +Z and −Z. A point of the surface
// maps to a disc's flat face by gnomonic projection (the line from the centre through the point
// meets the plane touching the disc's centre), where the number's strokes are drawn. The graphics
// card evaluates the same definition per pixel (src/scene/ballMaterial.ts); markingColor() is the
// reference, used to export textures for Blender and to test both.

import { numberSegments, STROKE_WIDTH } from './digits.ts';

/** Colours in sRGB, index = ball number (0: the cue ball). */
export const BALL_COLORS: readonly string[] = [
  '#f4f0e4', // cue ball
  '#f2b400', // 1 yellow
  '#1d46a8', // 2 blue
  '#d0281f', // 3 red
  '#3d2b86', // 4 purple
  '#ee6e17', // 5 orange
  '#0e6a3c', // 6 green
  '#7c1d24', // 7 maroon
  '#141414', // 8 black
  '#f2b400',
  '#1d46a8',
  '#d0281f',
  '#3d2b86',
  '#ee6e17',
  '#0e6a3c',
  '#7c1d24',
];

/** The white of the stripes and the number discs, and the ink of the numbers and disc rims. */
export const BALL_WHITE = '#f3efe2';
export const BALL_INK = '#151515';

const DEG = Math.PI / 180;
/** The band covers latitudes within ±35°: about 0.57 of the diameter tall, seen side on. */
export const STRIPE_SIN = Math.sin(35 * DEG);
/** Angular radius of a number disc: about 0.41 of the diameter across. */
export const DISC_ANGLE = 24 * DEG;
export const DISC_COS = Math.cos(DISC_ANGLE);
/** A thin darker rim around the disc, as on tournament sets. */
export const RIM_COS = Math.cos(DISC_ANGLE - 0.9 * DEG);
/** Height of the number on the disc's flat face, in units of the ball's radius. */
export const NUMBER_HEIGHT = 0.56;

export const isStripe = (n: number) => n >= 9 && n <= 15;
export const hasNumber = (n: number) => n >= 1 && n <= 15;

/**
 * The number's strokes on the disc's face, scaled to the ball (in units of R on the tangent
 * plane), and the pen's half width. Two-digit numbers are narrowed to fit the disc.
 */
export function discNumber(n: number): { segments: number[]; halfWidth: number } {
  const raw = numberSegments(n);
  const twoDigits = n >= 10;
  const scale = NUMBER_HEIGHT * (twoDigits ? 0.9 : 1);
  const squeeze = twoDigits ? 0.82 : 1;
  const segments = raw.map((v, i) => (i % 2 === 0 ? v * scale * squeeze : v * scale));
  return { segments, halfWidth: (STROKE_WIDTH * scale) / 2 };
}

export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function segmentDistance(px: number, py: number, s: readonly number[], i: number): number {
  const ax = s[i]!;
  const ay = s[i + 1]!;
  const bx = s[i + 2]! - ax;
  const by = s[i + 3]! - ay;
  const len2 = bx * bx + by * by;
  let t = len2 > 0 ? ((px - ax) * bx + (py - ay) * by) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - bx * t, py - ay - by * t);
}

const numbers = new Map<number, ReturnType<typeof discNumber>>();

/**
 * The colour (sRGB, 0–1) of ball `n` at the surface direction (x, y, z) of its own frame
 * (any length).
 */
export function markingColor(n: number, x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z);
  x /= len;
  y /= len;
  z /= len;
  const white = hexToRgb(BALL_WHITE);
  const colour = hexToRgb(BALL_COLORS[n]!);
  if (!hasNumber(n)) return colour;
  // The disc this point is nearest: +Z reads upright with +Y up; −Z with −Y up (upside down).
  const front = z >= 0;
  const facing = front ? z : -z;
  if (facing >= DISC_COS) {
    if (facing < RIM_COS) return mix(white, hexToRgb(BALL_INK), 0.55);
    // Gnomonic projection onto the disc's face. With s the disc's centre and up its upward
    // direction, right = up × s; that is +X for both discs (Y × Z and (−Y) × (−Z)).
    const u = x / facing;
    const v = (front ? y : -y) / facing;
    const { segments, halfWidth } = cached(n);
    for (let i = 0; i < segments.length; i += 4) {
      if (segmentDistance(u, v, segments, i) <= halfWidth) return hexToRgb(BALL_INK);
    }
    return white;
  }
  if (isStripe(n)) return Math.abs(y) < STRIPE_SIN ? colour : white;
  return colour;
}

function cached(n: number) {
  let value = numbers.get(n);
  if (!value) numbers.set(n, (value = discNumber(n)));
  return value;
}

function mix(a: [number, number, number], b: [number, number, number], t: number) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] as [
    number,
    number,
    number,
  ];
}
