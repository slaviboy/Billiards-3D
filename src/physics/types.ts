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

// The shapes the simulation works with. Units are SI (metres, seconds, kilograms, radians).
//
// The frame is the table's: x across the table from the left cushion nose (0) to the right one
// (W), y along it from the head cushion nose (0) to the foot cushion nose (L), z up from the cloth.
// Ball centres sit at z = R.

/** A pocket's number: 0 head-left corner, 1 left side, 2 foot-left corner, 3 foot-right corner,
 * 4 right side, 5 head-right corner. */
export type PocketId = 0 | 1 | 2 | 3 | 4 | 5;

/** A straight piece of cushion nose: a rail between two pockets, or a pocket's facing. */
export interface LinearCushion {
  readonly id: number;
  readonly p1x: number;
  readonly p1y: number;
  readonly p2x: number;
  readonly p2y: number;
  /** Unit normal of the line, pointing to the side balls come from. */
  readonly nx: number;
  readonly ny: number;
  /** Height of the nose above the cloth. */
  readonly h: number;
}

/** A pocket's rounded lip: a circle of cushion inside the rubber, met only on its exposed arc. */
export interface CircularCushion {
  readonly id: number;
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly h: number;
}

/** A pocket: a ball whose centre enters this circle has lost the slate and drops. */
export interface Pocket {
  readonly id: PocketId;
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

/** Everything a ball can meet on a table. */
export interface PhysicsTable {
  readonly W: number;
  readonly L: number;
  readonly linear: readonly LinearCushion[];
  readonly circular: readonly CircularCushion[];
  readonly pockets: readonly Pocket[];
}
