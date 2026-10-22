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

// Paints each ball's markings as an equirectangular texture (longitude across, latitude down), for
// the Blender ball set and its reference renders: blender/textures/ball-<n>.png. The game itself
// draws the markings on the graphics card from the same definition (src/balls/markings.ts).
// Usage: node scripts/export-ball-textures.ts [width]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { markingColor } from '../src/balls/markings.ts';

const width = Number(process.argv[2] ?? 2048);
const height = width / 2;
const out = join(import.meta.dirname, '..', 'blender', 'textures');
mkdirSync(out, { recursive: true });

/** sRGB 0–1 to a byte. */
const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
// 3 × 3 samples per pixel smooth the edges of the stripe, discs and numbers.
const SS = 3;

for (let n = 0; n <= 15; n++) {
  const png = new PNG({ width, height });
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sj = 0; sj < SS; sj++) {
        for (let si = 0; si < SS; si++) {
          // Blender's UV sphere: u runs with longitude around +Z (Blender's up), starting at −X
          // (checked by rendering), v from the south pole (0) to the north (1). The image's first
          // row is v = 1. The ball's own frame (markings.ts) has its band around +Y; in Blender
          // terms that axis is +Z.
          const u = (i + (si + 0.5) / SS) / width;
          const v = 1 - (j + (sj + 0.5) / SS) / height;
          const lon = u * 2 * Math.PI + Math.PI;
          const lat = (v - 0.5) * Math.PI;
          const bx = Math.cos(lat) * Math.cos(lon);
          const by = Math.cos(lat) * Math.sin(lon);
          const bz = Math.sin(lat);
          // Blender (x, y, z) to the ball frame: band axis +Y ← Blender +Z, discs ±Z ← Blender ∓Y.
          const [cr, cg, cb] = markingColor(n, bx, bz, -by);
          r += cr;
          g += cg;
          b += cb;
        }
      }
      const k = (j * width + i) * 4;
      png.data[k] = byte(r / (SS * SS));
      png.data[k + 1] = byte(g / (SS * SS));
      png.data[k + 2] = byte(b / (SS * SS));
      png.data[k + 3] = 255;
    }
  }
  writeFileSync(join(out, `ball-${n}.png`), PNG.sync.write(png));
}
console.log(`wrote 16 textures, ${width} × ${height}, to blender/textures/`);
