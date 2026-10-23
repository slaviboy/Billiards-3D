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

// Pictures of the balls for the players' cards, in the very markings the table's balls wear
// (src/balls/markings.ts): a small sphere, turned a little so it reads as round, its number to the
// front, lit from the upper left with a highlight, each pixel taking the colour of its point on
// the ball. Each ball is drawn once and kept as an image's address.

import { markingColor } from '../balls/markings.ts';

const DEG = Math.PI / 180;
/** The ball turned down and to the left, so the number sits just below the middle. */
const TILT = 14 * DEG;
const TURN = -10 * DEG;
const LIGHT = normalize(-0.45, 0.6, 0.66);
const HALF = normalize(LIGHT[0], LIGHT[1], LIGHT[2] + 1);
/** Samples per pixel along each side, for a smooth edge and number. */
const SAMPLES = 3;

function normalize(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

const toLinear = (c: number) => c ** 2.2;
const toSrgb = (c: number) => Math.round(255 * Math.min(1, Math.max(0, c)) ** (1 / 2.2));

/** The pixels (RGBA, row by row from the top) of ball `n`, `size` pixels across. */
export function ballPixels(n: number, size: number): Uint8ClampedArray<ArrayBuffer> {
  const data = new Uint8ClampedArray(size * size * 4);
  const cosT = Math.cos(TILT);
  const sinT = Math.sin(TILT);
  const cosU = Math.cos(TURN);
  const sinU = Math.sin(TURN);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          // The view's direction to this point of the sphere: x right, y up, z to the eye.
          const x = ((px + (sx + 0.5) / SAMPLES) / size) * 2 - 1;
          const y = 1 - ((py + (sy + 0.5) / SAMPLES) / size) * 2;
          const rr = x * x + y * y;
          if (rr > 1) continue;
          const z = Math.sqrt(1 - rr);
          // Back into the ball's own frame: undo the turn about Y, then the tilt about X.
          const bx = x * cosU - z * sinU;
          const bz0 = x * sinU + z * cosU;
          const by = y * cosT + bz0 * sinT;
          const bz = -y * sinT + bz0 * cosT;
          const [cr, cg, cb] = markingColor(n, bx, by, bz);
          const diffuse = Math.max(0, x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2]);
          const facing = Math.max(0, x * HALF[0] + y * HALF[1] + z * HALF[2]);
          const shade = 0.22 + 0.9 * diffuse;
          const shine = 0.6 * facing ** 70 + 0.06 * facing ** 6;
          r += toLinear(cr) * shade + shine;
          g += toLinear(cg) * shade + shine;
          b += toLinear(cb) * shade + shine;
          hits++;
        }
      }
      if (hits === 0) continue;
      const i = (py * size + px) * 4;
      data[i] = toSrgb(r / hits);
      data[i + 1] = toSrgb(g / hits);
      data[i + 2] = toSrgb(b / hits);
      data[i + 3] = Math.round((255 * hits) / (SAMPLES * SAMPLES));
    }
  }
  return data;
}

const images = new Map<string, string>();

/** The picture of ball `n` as an image's address, `size` pixels across (drawn once). */
export function ballImage(n: number, size = 64): string {
  const key = `${n}:${size}`;
  let url = images.get(key);
  if (!url) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (context) {
      context.putImageData(new ImageData(ballPixels(n, size), size, size), 0, 0);
    }
    url = canvas.toDataURL('image/png');
    images.set(key, url);
  }
  return url;
}
