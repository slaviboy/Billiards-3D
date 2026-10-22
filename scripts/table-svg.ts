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

// Draws a table's outline as an SVG for inspection: the cushion noses and lip roundings, the
// pockets' slate cuts, the rail's outer edge, the sights, the head string and spots, and a ball for
// scale. 1 px = 1 mm.
// Usage: node scripts/table-svg.ts <7ft|9ft> <output.svg>

import { writeFileSync } from 'node:fs';
import { buildTable } from '../src/table/geometry.ts';
import { BALL_RADIUS, isTableSize, tableSpec } from '../src/table/spec.ts';

const [size, output] = process.argv.slice(2);
if (!isTableSize(size) || !output) {
  console.error('usage: node scripts/table-svg.ts <7ft|9ft> <output.svg>');
  process.exit(1);
}
const spec = tableSpec(size);
const table = buildTable(spec);
const mm = (v: number) => +(v * 1000).toFixed(3);
const margin = spec.railWidth + 0.03;
const width = mm(spec.W + 2 * margin);
const height = mm(spec.L + 2 * margin);
// Table y grows up the page: flip it.
const X = (x: number) => mm(x + margin);
const Y = (y: number) => mm(spec.L + margin - y);

const parts: string[] = [];
parts.push(`<rect width="${width}" height="${height}" fill="#1b1d22"/>`);
parts.push(
  `<rect x="${X(-spec.railWidth)}" y="${Y(spec.L + spec.railWidth)}" width="${mm(spec.W + 2 * spec.railWidth)}" height="${mm(spec.L + 2 * spec.railWidth)}" fill="#5a2f1a"/>`,
);
parts.push(
  `<rect x="${X(0)}" y="${Y(spec.L)}" width="${mm(spec.W)}" height="${mm(spec.L)}" fill="#1f6f74"/>`,
);
for (const p of table.pockets) {
  parts.push(
    `<circle cx="${X(p.center.x)}" cy="${Y(p.center.y)}" r="${mm(p.radius)}" fill="#050505" opacity="0.85"/>`,
  );
}
for (const cushion of table.cushions) {
  const d: string[] = [];
  for (const [i, piece] of cushion.path.entries()) {
    if (i === 0) d.push(`M ${X(piece.from.x)} ${Y(piece.from.y)}`);
    if (piece.kind === 'line') d.push(`L ${X(piece.to.x)} ${Y(piece.to.y)}`);
    // The page's y is flipped, so a counter-clockwise turn on the table is clockwise on the page.
    else
      d.push(
        `A ${mm(piece.radius)} ${mm(piece.radius)} 0 0 ${piece.ccw ? 0 : 1} ${X(piece.to.x)} ${Y(piece.to.y)}`,
      );
  }
  parts.push(`<path d="${d.join(' ')}" fill="none" stroke="#e7d9a8" stroke-width="1.5"/>`);
}
for (const jaw of table.physics.circular) {
  parts.push(
    `<circle cx="${X(jaw.cx)}" cy="${Y(jaw.cy)}" r="${mm(jaw.r)}" fill="none" stroke="#ff7b54" stroke-width="0.6"/>`,
  );
}
for (const s of table.sights)
  parts.push(`<circle cx="${X(s.x)}" cy="${Y(s.y)}" r="6" fill="#f3efe2"/>`);
parts.push(
  `<line x1="${X(0)}" y1="${Y(table.headString)}" x2="${X(spec.W)}" y2="${Y(table.headString)}" stroke="#ffffff55" stroke-dasharray="8 6"/>`,
);
for (const spot of [table.headSpot, table.centerSpot, table.footSpot]) {
  parts.push(`<circle cx="${X(spot.x)}" cy="${Y(spot.y)}" r="3" fill="#ffffffaa"/>`);
}
parts.push(
  `<circle cx="${X(BALL_RADIUS)}" cy="${Y(spec.L / 4)}" r="${mm(BALL_RADIUS)}" fill="#f3efe2"/>`,
);
writeFileSync(
  output,
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>\n`,
);
console.log(`wrote ${output}`);
