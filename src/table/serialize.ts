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

// The table's geometry as the JSON the Blender scripts build the model from
// (blender/table-geometry-<size>.json, written by scripts/export-table.ts). Points are [x, y] in
// the table frame, in metres; Blender places them at X = x - W/2, Y = y - L/2.

import { BALL_RADIUS, type TableSize, tableSpec } from './spec.ts';
import { buildTable, type PathPiece, type Point } from './geometry.ts';

export const GEOMETRY_VERSION = 1;

const xy = (p: Point): [number, number] => [p.x, p.y];

function piece(p: PathPiece): object {
  return p.kind === 'line'
    ? { line: [xy(p.from), xy(p.to)] }
    : {
        arc: { center: xy(p.center), radius: p.radius, from: xy(p.from), to: xy(p.to), ccw: p.ccw },
      };
}

export function tableGeometryJson(size: TableSize): object {
  const spec = tableSpec(size);
  const table = buildTable(spec);
  return {
    version: GEOMETRY_VERSION,
    units: 'metres',
    frame: 'table: x across from the left nose, y along from the head nose, z up from the cloth',
    size,
    W: spec.W,
    L: spec.L,
    ballRadius: BALL_RADIUS,
    noseHeight: spec.noseHeight,
    cushionWidth: spec.cushionWidth,
    railWidth: spec.railWidth,
    railHeight: spec.railHeight,
    bedHeight: spec.bedHeight,
    backDraft: spec.backDraft,
    facingThickness: spec.facingThickness,
    profile: spec.cushionProfile,
    cushions: table.cushions.map((c) => ({
      rail: c.rail,
      pockets: c.pockets,
      back: xy(c.back),
      path: c.path.map(piece),
    })),
    pockets: table.pockets.map((p) => ({
      id: p.id,
      corner: p.corner,
      center: xy(p.center),
      radius: p.radius,
      axis: xy(p.axis),
      lips: p.lips.map(xy),
    })),
    sights: table.sights.map(xy),
    headString: table.headString,
    spots: { head: xy(table.headSpot), center: xy(table.centerSpot), foot: xy(table.footSpot) },
  };
}
