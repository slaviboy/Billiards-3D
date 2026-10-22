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

// The two tables, described once. The simulation, the 3D model (through the Blender exporter) and
// the rules all read these numbers, so the cushions a ball bounces off are the cushions you see.
// Sources and reasons for every value: docs/visual-research.md, section 2.

export type TableSize = '7ft' | '9ft';

export const TABLE_SIZES: readonly TableSize[] = ['7ft', '9ft'];

export function isTableSize(value: unknown): value is TableSize {
  return value === '7ft' || value === '9ft';
}

const INCH = 0.0254;

/** Ball radius: 2¼ in diameter (WPA). The same for both tables. */
export const BALL_RADIUS = 0.028575;

export interface TableSpec {
  readonly size: TableSize;
  /** Playing surface across, cushion nose to nose (x). */
  readonly W: number;
  /** Playing surface along, cushion nose to nose (y). */
  readonly L: number;
  /** Height of the cushion nose above the cloth: 63.5 % of the ball's diameter. */
  readonly noseHeight: number;
  /** Cushion width, featherstrip to nose. */
  readonly cushionWidth: number;
  /** Rail width, cushion nose to the rail's outer edge. */
  readonly railWidth: number;
  /** Height of the rail cap above the cloth. */
  readonly railHeight: number;
  /** Pocket mouths, lip to lip, where the nose turns into the pocket. */
  readonly cornerMouth: number;
  readonly sideMouth: number;
  /** Angle between the cushion nose and the pocket facing, through the rubber, in degrees. */
  readonly cornerCutAngle: number;
  readonly sideCutAngle: number;
  /** From the middle of the mouth line to the edge of the pocket cut in the slate. */
  readonly cornerShelf: number;
  readonly sideShelf: number;
  /** Rounding of the lip where nose and facing meet. */
  readonly cornerJawRadius: number;
  readonly sideJawRadius: number;
  /** Radius of the pocket cut in the slate (the circle a ball drops through). */
  readonly cornerPocketRadius: number;
  readonly sidePocketRadius: number;
  /** Tilt of the pocket's back wall from vertical, in degrees (appearance only). */
  readonly backDraft: number;
  /** Thickness of the hard rubber facings (appearance only). */
  readonly facingThickness: number;
  /** Rail sights: spacing along every rail and distance of their centres behind the nose. */
  readonly sightSpacing: number;
  readonly sightOffset: number;
  /** Height of the cloth above the floor. */
  readonly bedHeight: number;
  /**
   * The cushion's cross-section as (distance behind the nose, height above the cloth) points,
   * around the rubber: the nose first, then the top up to the featherstrip, the back, and the
   * undercut back to the nose.
   */
  readonly cushionProfile: readonly (readonly [number, number])[];
}

const NOSE_HEIGHT = 0.635 * 2 * BALL_RADIUS;
const CUSHION_WIDTH = 2 * INCH;
const RAIL_HEIGHT = 1.75 * INCH;

/** Rubber cross-section shared by both tables (the K66-like triangle of a modern cushion). */
const PROFILE: readonly (readonly [number, number])[] = [
  [0, NOSE_HEIGHT],
  [0.0025, NOSE_HEIGHT + 0.0042],
  [CUSHION_WIDTH, RAIL_HEIGHT - 0.0015],
  [CUSHION_WIDTH, 0.0045],
  [0.007, NOSE_HEIGHT - 0.0075],
];

const POCKETS = {
  cornerMouth: 4.5625 * INCH,
  sideMouth: 5.0625 * INCH,
  cornerCutAngle: 142,
  sideCutAngle: 104,
  cornerShelf: 1.5 * INCH,
  sideShelf: 0.1875 * INCH,
  cornerJawRadius: 0.25 * INCH,
  sideJawRadius: 0.25 * INCH,
  cornerPocketRadius: 2.45 * INCH,
  sidePocketRadius: 2.55 * INCH,
  backDraft: 13.5,
  facingThickness: 0.125 * INCH,
} as const;

const NINE_FOOT: TableSpec = {
  size: '9ft',
  W: 50 * INCH,
  L: 100 * INCH,
  noseHeight: NOSE_HEIGHT,
  cushionWidth: CUSHION_WIDTH,
  railWidth: 6.5 * INCH,
  railHeight: RAIL_HEIGHT,
  ...POCKETS,
  sightSpacing: 12.5 * INCH,
  sightOffset: (3 + 11 / 16) * INCH,
  bedHeight: 30 * INCH,
  cushionProfile: PROFILE,
};

const SEVEN_FOOT: TableSpec = {
  size: '7ft',
  W: 39 * INCH,
  L: 78 * INCH,
  noseHeight: NOSE_HEIGHT,
  cushionWidth: CUSHION_WIDTH,
  railWidth: 5.5 * INCH,
  railHeight: RAIL_HEIGHT,
  ...POCKETS,
  sightSpacing: 9.75 * INCH,
  sightOffset: (3 + 11 / 16) * INCH,
  bedHeight: 30 * INCH,
  cushionProfile: PROFILE,
};

export function tableSpec(size: TableSize): TableSpec {
  return size === '9ft' ? NINE_FOOT : SEVEN_FOOT;
}
