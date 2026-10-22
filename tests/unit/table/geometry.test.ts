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

// The built table measures what the WPA specifies: mouths lip to lip, the cut angles recovered from
// the cushion lines themselves, shelves, sights; and its outline is continuous and symmetric.

import { describe, expect, it } from 'vitest';
import { buildTable, type Point } from '../../../src/table/geometry.ts';
import { fromScene, toScene } from '../../../src/table/frame.ts';
import { BALL_RADIUS, TABLE_SIZES, tableSpec } from '../../../src/table/spec.ts';

const INCH = 0.0254;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const degrees = (radians: number) => (radians * 180) / Math.PI;

describe.each(TABLE_SIZES)('%s table', (size) => {
  const spec = tableSpec(size);
  const table = buildTable(spec);
  const { physics } = table;

  it('has the specified playing surface', () => {
    expect(spec.W).toBeCloseTo(size === '9ft' ? 1.27 : 0.9906, 12);
    expect(spec.L).toBeCloseTo(2 * spec.W, 12);
    expect(spec.noseHeight / (2 * BALL_RADIUS)).toBeCloseTo(0.635, 12);
  });

  it('has six pockets with WPA mouths, lip to lip', () => {
    expect(table.pockets).toHaveLength(6);
    for (const pocket of table.pockets) {
      const mouth = dist(pocket.lips[0], pocket.lips[1]);
      expect(mouth).toBeCloseTo(pocket.corner ? spec.cornerMouth : spec.sideMouth, 12);
      const inches = mouth / INCH;
      if (pocket.corner) expect(inches >= 4.5 && inches <= 4.625).toBe(true);
      else expect(inches >= 5 && inches <= 5.125).toBe(true);
    }
  });

  it('cuts every facing at the WPA angle to its nose', () => {
    // Recovered from the physics segments: nose i runs between lips; facings 6+2i and 7+2i.
    for (let rail = 0; rail < 6; rail++) {
      const nose = physics.linear[rail]!;
      const noseDir = unit({ x: nose.p2x - nose.p1x, y: nose.p2y - nose.p1y });
      for (const end of [0, 1]) {
        const facing = physics.linear[6 + rail * 2 + end]!;
        // Facing runs from the back of the cushion to the lip; reverse it to leave the lip.
        const facingDir = unit({ x: facing.p1x - facing.p2x, y: facing.p1y - facing.p2y });
        // The nose leaves the lip toward the rail's far end: away from the pocket.
        const along = end === 0 ? noseDir : { x: -noseDir.x, y: -noseDir.y };
        const angle = degrees(Math.acos(along.x * facingDir.x + along.y * facingDir.y));
        const pocket = table.cushions[rail]!.pockets[end]!;
        const expected = pocket === 1 || pocket === 4 ? 104 : 142;
        expect(angle).toBeCloseTo(expected, 9);
      }
    }
  });

  it('puts each pocket cut one shelf beyond the middle of its mouth', () => {
    for (const pocket of table.pockets) {
      const mid = {
        x: (pocket.lips[0].x + pocket.lips[1].x) / 2,
        y: (pocket.lips[0].y + pocket.lips[1].y) / 2,
      };
      const shelf = dist(mid, pocket.center) - pocket.radius;
      expect(shelf).toBeCloseTo(pocket.corner ? spec.cornerShelf : spec.sideShelf, 12);
      const inches = shelf / INCH;
      if (pocket.corner) expect(inches >= 1 && inches <= 2.25).toBe(true);
      else expect(inches >= 0 && inches <= 0.375).toBe(true);
    }
  });

  it('leaves a throat wide enough for a ball at the shelf', () => {
    for (const pocket of table.pockets) {
      // Facing lines of this pocket, measured across the axis at the shelf depth.
      const facings = physics.linear.filter((segment, i) => {
        if (i < 6) return false;
        const cushion = table.cushions[Math.floor((i - 6) / 2)]!;
        return cushion.pockets[(i - 6) % 2] === pocket.id;
      });
      expect(facings).toHaveLength(2);
      const mid = {
        x: (pocket.lips[0].x + pocket.lips[1].x) / 2,
        y: (pocket.lips[0].y + pocket.lips[1].y) / 2,
      };
      const shelf = pocket.corner ? spec.cornerShelf : spec.sideShelf;
      const across = { x: -pocket.axis.y, y: pocket.axis.x };
      const at = { x: mid.x + shelf * pocket.axis.x, y: mid.y + shelf * pocket.axis.y };
      const hits = facings.map((f) => {
        // Where the facing line crosses the line through `at` along `across`.
        const d = { x: f.p2x - f.p1x, y: f.p2y - f.p1y };
        const t = ((f.p1x - at.x) * d.y - (f.p1y - at.y) * d.x) / (across.x * d.y - across.y * d.x);
        return t;
      });
      const throat = Math.abs(hits[0]! - hits[1]!);
      expect(throat).toBeGreaterThan(2 * BALL_RADIUS * 1.5);
    }
  });

  it('rounds every lip with a circle tangent to its nose and its facing', () => {
    for (let rail = 0; rail < 6; rail++) {
      const nose = physics.linear[rail]!;
      for (const end of [0, 1]) {
        const jaw = physics.circular[rail * 2 + end]!;
        const facing = physics.linear[6 + rail * 2 + end]!;
        for (const segment of [nose, facing]) {
          const distance = Math.abs(
            (jaw.cx - segment.p1x) * segment.nx + (jaw.cy - segment.p1y) * segment.ny,
          );
          expect(distance).toBeCloseTo(jaw.r, 12);
          // The circle lies behind the cushion line, inside the rubber.
          expect(
            (jaw.cx - segment.p1x) * segment.nx + (jaw.cy - segment.p1y) * segment.ny,
          ).toBeLessThan(0);
        }
      }
    }
  });

  it('draws one continuous outline per cushion', () => {
    expect(table.cushions).toHaveLength(6);
    for (const cushion of table.cushions) {
      for (let i = 1; i < cushion.path.length; i++) {
        expect(dist(cushion.path[i - 1]!.to, cushion.path[i]!.from)).toBeLessThan(1e-12);
      }
      for (const piece of cushion.path) {
        if (piece.kind !== 'arc') continue;
        expect(dist(piece.center, piece.from)).toBeCloseTo(piece.radius, 12);
        expect(dist(piece.center, piece.to)).toBeCloseTo(piece.radius, 12);
      }
    }
  });

  it('points every cushion normal at the side balls come from', () => {
    const middle = { x: spec.W / 2, y: spec.L / 2 };
    for (const nose of physics.linear.slice(0, 6)) {
      expect((middle.x - nose.p1x) * nose.nx + (middle.y - nose.p1y) * nose.ny).toBeGreaterThan(0);
    }
    for (const pocket of table.pockets) {
      const facings = physics.linear.filter((_, i) => {
        if (i < 6) return false;
        return table.cushions[Math.floor((i - 6) / 2)]!.pockets[(i - 6) % 2] === pocket.id;
      });
      // Into the throat: toward the pocket's centre.
      for (const f of facings) {
        expect((pocket.center.x - f.p1x) * f.nx + (pocket.center.y - f.p1y) * f.ny).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it('is symmetric about both centre lines', () => {
    const key = (p: Point) => `${(p.x - spec.W / 2).toFixed(9)},${(p.y - spec.L / 2).toFixed(9)}`;
    const points = physics.linear.flatMap((s) => [
      { x: s.p1x, y: s.p1y },
      { x: s.p2x, y: s.p2y },
    ]);
    const set = new Set(points.map(key));
    for (const p of points) {
      expect(set.has(key({ x: spec.W - p.x, y: p.y }))).toBe(true);
      expect(set.has(key({ x: p.x, y: spec.L - p.y }))).toBe(true);
    }
  });

  it('places the 18 sights an eighth of the length apart, 3 11/16 in behind the nose', () => {
    expect(table.sights).toHaveLength(18);
    expect(spec.sightSpacing).toBeCloseTo(spec.L / 8, 12);
    for (const sight of table.sights) {
      const behind = Math.max(-sight.x, sight.x - spec.W, -sight.y, sight.y - spec.L);
      expect(behind).toBeCloseTo((3 + 11 / 16) * INCH, 12);
    }
  });

  it('marks the head string and the spots', () => {
    expect(table.headString).toBeCloseTo(spec.L / 4, 12);
    expect(table.footSpot.y).toBeCloseTo((3 * spec.L) / 4, 12);
    expect(table.footSpot.x).toBeCloseTo(spec.W / 2, 12);
  });
});

describe('scene frame', () => {
  it('round-trips points and keeps the head rail toward the viewer', () => {
    const out = { x: 0, y: 0, z: 0 };
    toScene(0.3, 0.1, 0.028575, 1.27, 2.54, out);
    expect(out.z).toBeGreaterThan(0); // near the head rail
    expect(out.y).toBeCloseTo(0.028575, 15);
    const back = fromScene(out.x, out.y, out.z, 1.27, 2.54, { x: 0, y: 0, z: 0 });
    expect(back.x).toBeCloseTo(0.3, 15);
    expect(back.y).toBeCloseTo(0.1, 15);
    expect(back.z).toBeCloseTo(0.028575, 15);
  });
});

function unit(p: Point): Point {
  const n = Math.hypot(p.x, p.y);
  return { x: p.x / n, y: p.y / n };
}
