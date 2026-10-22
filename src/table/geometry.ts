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

// The table's cushion outline, pockets and markings, built from its specification.
//
// Each pocket lip is where a straight cushion nose meets the pocket's facing: the "pointed lip" the
// WPA measures the mouth between. The facing leaves the lip at the cut angle (142° at the corners,
// 104° at the sides, through the rubber), and a small circle rounds the lip, tangent to both. The
// pocket cut in the slate is a circle whose nearest point lies one shelf beyond the middle of the
// mouth line. The pieces are the ones pooltool's pocket table is made of (straight cushions, lip
// circles, pocket circles), built here from the WPA measurements.
//
// The same outline goes to the simulation (as cushions and pockets) and to Blender (as the path the
// cushion's cross-section is swept along), so what a ball bounces off is what is drawn.

import { cos, sin, radians } from '../physics/dmath.ts';
import type {
  CircularCushion,
  LinearCushion,
  PhysicsTable,
  Pocket,
  PocketId,
} from '../physics/types.ts';
import type { TableSpec } from './spec.ts';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** One piece of a cushion's nose outline, in the direction the outline runs. */
export type PathPiece =
  | { readonly kind: 'line'; readonly from: Point; readonly to: Point }
  | {
      readonly kind: 'arc';
      readonly center: Point;
      readonly radius: number;
      readonly from: Point;
      readonly to: Point;
      /** Whether the arc turns counter-clockwise (seen from above) from `from` to `to`. */
      readonly ccw: boolean;
    };

/** A cushion between two pockets: its nose outline, from one facing's back end to the other's. */
export interface CushionPiece {
  readonly rail: number;
  readonly pockets: readonly [PocketId, PocketId];
  /** Unit vector pointing from the nose into the rubber (away from the cloth). */
  readonly back: Point;
  readonly path: readonly PathPiece[];
}

export interface PocketShape {
  readonly id: PocketId;
  readonly corner: boolean;
  readonly center: Point;
  readonly radius: number;
  /** Unit vector from the mouth out of the table. */
  readonly axis: Point;
  /** The two lips (the pointed corners where the nose turns into the pocket). */
  readonly lips: readonly [Point, Point];
}

export interface Sight {
  readonly x: number;
  readonly y: number;
}

export interface TableGeometry {
  readonly spec: TableSpec;
  readonly physics: PhysicsTable;
  readonly cushions: readonly CushionPiece[];
  readonly pockets: readonly PocketShape[];
  readonly sights: readonly Sight[];
  /** The head string (y), and the head, centre and foot spots. */
  readonly headString: number;
  readonly headSpot: Point;
  readonly centerSpot: Point;
  readonly footSpot: Point;
}

/** A pointed lip: where it is, which way the nose runs from it, and which way the rubber lies. */
interface Lip {
  readonly pocket: PocketId;
  readonly vertex: Point;
  /** Along the nose, away from the pocket. */
  readonly along: Point;
  /** From the nose into the rubber. */
  readonly back: Point;
  readonly cutAngle: number;
  readonly jawRadius: number;
}

interface BuiltLip {
  readonly lip: Lip;
  /** Where the lip's rounding meets the nose and the facing. */
  readonly onNose: Point;
  readonly onFacing: Point;
  /** The facing's far end, at the back of the cushion. */
  readonly facingEnd: Point;
  readonly jaw: Point;
  /** Unit normal of the facing toward the pocket's throat. */
  readonly facingNormal: Point;
}

const add = (a: Point, b: Point, k = 1): Point => ({ x: a.x + k * b.x, y: a.y + k * b.y });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;

function buildLip(lip: Lip, cushionWidth: number): BuiltLip {
  const angle = radians(lip.cutAngle);
  const c = cos(angle);
  const s = sin(angle);
  // The facing leaves the lip at the cut angle from the nose, into the rubber.
  const facing = { x: lip.along.x * c + lip.back.x * s, y: lip.along.y * c + lip.back.y * s };
  // A circle of radius r tangent to both sides of a corner with angle α touches each side
  // r / tan(α/2) = r (1 + cos α) / sin α from the corner.
  const tangent = (lip.jawRadius * (1 + c)) / s;
  const onNose = add(lip.vertex, lip.along, tangent);
  const onFacing = add(lip.vertex, facing, tangent);
  const jaw = add(onNose, lip.back, lip.jawRadius);
  const facingEnd = add(lip.vertex, facing, cushionWidth / dot(facing, lip.back));
  // Of the facing's two normals, the one on the pocket's side (opposite the nose's direction).
  let normal = { x: -facing.y, y: facing.x };
  if (dot(normal, lip.along) > 0) normal = { x: facing.y, y: -facing.x };
  return { lip, onNose, onFacing, facingEnd, jaw, facingNormal: normal };
}

export function buildTable(spec: TableSpec): TableGeometry {
  const { W, L, noseHeight: h } = spec;
  // Distance of a corner lip from the corner where the two noses would meet: the mouth is the
  // hypotenuse of the right-angled triangle the lips make with that corner.
  const k = spec.cornerMouth / Math.SQRT2;
  const s2 = spec.sideMouth / 2;
  const corner = (pocket: PocketId, vertex: Point, along: Point, back: Point): Lip => ({
    pocket,
    vertex,
    along,
    back,
    cutAngle: spec.cornerCutAngle,
    jawRadius: spec.cornerJawRadius,
  });
  const side = (pocket: PocketId, vertex: Point, along: Point, back: Point): Lip => ({
    pocket,
    vertex,
    along,
    back,
    cutAngle: spec.sideCutAngle,
    jawRadius: spec.sideJawRadius,
  });
  const left = { x: -1, y: 0 };
  const right = { x: 1, y: 0 };
  const down = { x: 0, y: -1 };
  const up = { x: 0, y: 1 };

  // The six cushions, each from one pocket's lip to the next pocket's, around the table.
  const rails: ReadonlyArray<readonly [Lip, Lip]> = [
    [corner(0, { x: 0, y: k }, up, left), side(1, { x: 0, y: L / 2 - s2 }, down, left)],
    [side(1, { x: 0, y: L / 2 + s2 }, up, left), corner(2, { x: 0, y: L - k }, down, left)],
    [corner(2, { x: k, y: L }, right, up), corner(3, { x: W - k, y: L }, left, up)],
    [corner(3, { x: W, y: L - k }, down, right), side(4, { x: W, y: L / 2 + s2 }, up, right)],
    [side(4, { x: W, y: L / 2 - s2 }, down, right), corner(5, { x: W, y: k }, up, right)],
    [corner(5, { x: W - k, y: 0 }, left, down), corner(0, { x: k, y: 0 }, right, down)],
  ];

  const linear: LinearCushion[] = [];
  const circular: CircularCushion[] = [];
  const cushions: CushionPiece[] = [];
  const built = rails.map(
    ([a, b]) => [buildLip(a, spec.cushionWidth), buildLip(b, spec.cushionWidth)] as const,
  );

  // Noses first (ids 0–5), then facings (6–17) and lip circles (0–11), two per cushion.
  built.forEach(([a, b], rail) => {
    const normal = { x: -a.lip.back.x, y: -a.lip.back.y };
    linear.push(line(rail, a.onNose, b.onNose, normal, h));
  });
  built.forEach(([a, b], rail) => {
    for (const [end, lip] of [a, b].entries()) {
      const id = rail * 2 + end;
      linear.push(line(6 + id, lip.facingEnd, lip.onFacing, lip.facingNormal, h));
      circular.push({ id, cx: lip.jaw.x, cy: lip.jaw.y, r: lip.lip.jawRadius, h });
    }
    cushions.push({
      rail,
      pockets: [a.lip.pocket, b.lip.pocket],
      back: a.lip.back,
      path: [
        { kind: 'line', from: a.facingEnd, to: a.onFacing },
        arc(a, a.onFacing, a.onNose),
        { kind: 'line', from: a.onNose, to: b.onNose },
        arc(b, b.onNose, b.onFacing),
        { kind: 'line', from: b.onFacing, to: b.facingEnd },
      ],
    });
  });

  // Each pocket's two lips: a corner's lie on two cushions, a side's on the two halves of a rail.
  const lipsOf = new Map<PocketId, Point[]>();
  for (const [a, b] of rails) {
    for (const lip of [a, b])
      lipsOf.set(lip.pocket, [...(lipsOf.get(lip.pocket) ?? []), lip.vertex]);
  }
  const pocketAxes: Record<PocketId, Point> = {
    0: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
    1: left,
    2: { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
    3: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
    4: right,
    5: { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
  };
  const pockets: PocketShape[] = [];
  const physicsPockets: Pocket[] = [];
  for (const id of [0, 1, 2, 3, 4, 5] as const) {
    const [p, q] = lipsOf.get(id)!;
    const isCorner = id !== 1 && id !== 4;
    const mid = { x: (p!.x + q!.x) / 2, y: (p!.y + q!.y) / 2 };
    const radius = isCorner ? spec.cornerPocketRadius : spec.sidePocketRadius;
    const shelf = isCorner ? spec.cornerShelf : spec.sideShelf;
    const axis = pocketAxes[id];
    const center = add(mid, axis, shelf + radius);
    pockets.push({ id, corner: isCorner, center, radius, axis, lips: [p!, q!] });
    physicsPockets.push({ id, cx: center.x, cy: center.y, r: radius });
  }

  return {
    spec,
    physics: { W, L, linear, circular, pockets: physicsPockets },
    cushions,
    pockets,
    sights: sights(spec),
    headString: L / 4,
    headSpot: { x: W / 2, y: L / 4 },
    centerSpot: { x: W / 2, y: L / 2 },
    footSpot: { x: W / 2, y: (3 * L) / 4 },
  };
}

function line(id: number, from: Point, to: Point, normal: Point, h: number): LinearCushion {
  return { id, p1x: from.x, p1y: from.y, p2x: to.x, p2y: to.y, nx: normal.x, ny: normal.y, h };
}

/** The exposed arc of a lip's rounding, between its two tangent points. */
function arc(lip: BuiltLip, from: Point, to: Point): PathPiece {
  // The arc bulges toward the cloth; its turning direction follows from the cross product of the
  // radii to its ends.
  const a = { x: from.x - lip.jaw.x, y: from.y - lip.jaw.y };
  const b = { x: to.x - lip.jaw.x, y: to.y - lip.jaw.y };
  return {
    kind: 'arc',
    center: lip.jaw,
    radius: lip.lip.jawRadius,
    from,
    to,
    ccw: a.x * b.y - a.y * b.x > 0,
  };
}

/** The 18 rail sights: seven along each long rail but the side pocket's, three on each end. */
function sights(spec: TableSpec): Sight[] {
  const { W, L, sightSpacing: d, sightOffset: o } = spec;
  const out: Sight[] = [];
  for (let i = 1; i < 8; i++) {
    if (i === 4) continue;
    out.push({ x: -o, y: i * d }, { x: W + o, y: i * d });
  }
  for (let i = 1; i < 4; i++) out.push({ x: (i * W) / 4, y: -o }, { x: (i * W) / 4, y: L + o });
  return out;
}
