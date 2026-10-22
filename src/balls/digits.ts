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

// The numbers printed on the balls, drawn for this game as stroke skeletons: lines and arcs that a
// round pen of fixed width traces, in the bold, rounded style billiard numbers use. A digit is
// "ink" wherever the distance to its skeleton is under half the pen's width, which works the same
// on the graphics card (src/scene/ballMaterial.ts) and in Node (the texture exporter), and stays
// sharp at any size.
//
// Coordinates: x right, y up, a digit 1 unit tall centred on the origin.

export type Stroke = readonly (readonly [number, number])[];

/** Points along an elliptic arc from angle a0 to a1 (radians, counter-clockwise from +x). */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 14) {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

const PI = Math.PI;

/** Each digit's strokes (polylines). */
export const DIGIT_STROKES: readonly (readonly Stroke[])[] = [
  // 0
  [arc(0, 0, 0.215, 0.39, 0, 2 * PI, 28)],
  // 1
  [
    [
      [-0.12, 0.27],
      [0.04, 0.39],
      [0.04, -0.39],
    ],
  ],
  // 2
  [[...arc(0, 0.16, 0.2, 0.23, PI * 0.95, -PI * 0.22, 16), [-0.21, -0.39], [0.23, -0.39]]],
  // 3
  [
    [...arc(-0.005, 0.19, 0.19, 0.2, PI * 0.85, -PI / 2, 12), [-0.03, -0.01]],
    [[-0.03, -0.01], ...arc(-0.005, -0.19, 0.205, 0.2, PI / 2, -PI * 0.85, 12)],
  ],
  // 4
  [
    [
      [0.09, -0.39],
      [0.09, 0.39],
      [-0.23, -0.13],
      [0.25, -0.13],
    ],
  ],
  // 5
  [
    [
      [0.2, 0.39],
      [-0.15, 0.39],
      [-0.18, 0.03],
      ...arc(0, -0.15, 0.21, 0.23, PI * 0.72, -PI * 0.88, 16),
    ],
  ],
  // 6
  [
    [[0.17, 0.36], ...arc(0.03, 0.02, 0.2, 0.39, PI * 0.42, PI * 1.08, 10)],
    arc(0, -0.15, 0.205, 0.235, 0, 2 * PI, 24),
  ],
  // 7
  [
    [
      [-0.22, 0.39],
      [0.23, 0.39],
      [-0.06, -0.39],
    ],
  ],
  // 8
  [arc(0, 0.2, 0.17, 0.19, 0, 2 * PI, 22), arc(0, -0.18, 0.205, 0.21, 0, 2 * PI, 24)],
  // 9: the 6 turned half round
  [
    [[-0.17, -0.36], ...arc(-0.03, -0.02, 0.2, 0.39, PI * 1.42, PI * 2.08, 10)],
    arc(0, 0.15, 0.205, 0.235, 0, 2 * PI, 24),
  ],
];

/** Pen width, in digit heights. */
export const STROKE_WIDTH = 0.18;
/** Advance between two digits of a number, in digit heights. */
export const DIGIT_ADVANCE = 0.56;

/**
 * The strokes of a ball's number as line segments [x1, y1, x2, y2, …], one digit height tall,
 * centred; 6 and 9 underscored (WPA equipment specification 16).
 */
export function numberSegments(n: number): number[] {
  const digits = String(n).split('').map(Number);
  const out: number[] = [];
  const start = (-(digits.length - 1) * DIGIT_ADVANCE) / 2;
  digits.forEach((d, i) => {
    const dx = start + i * DIGIT_ADVANCE;
    for (const stroke of DIGIT_STROKES[d]!) {
      for (let k = 1; k < stroke.length; k++) {
        out.push(stroke[k - 1]![0] + dx, stroke[k - 1]![1], stroke[k]![0] + dx, stroke[k]![1]);
      }
    }
  });
  if (n === 6 || n === 9) out.push(-0.2, -0.62, 0.2, -0.62);
  return out;
}
