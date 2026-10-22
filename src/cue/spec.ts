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

// The cue, described once: a two-piece 58 in cue with a 13 mm tip and a pro taper (sources in
// docs/visual-research.md, section 4). Blender turns each part from its profile
// (blender/scripts/cue.py, from blender/cue-spec.json); the game uses the tip's position and size
// to put the cue against the ball.
//
// Each part is a list of (distance from the tip end along the cue, radius) points, in metres.

const IN = 0.0254;

export interface CuePart {
  readonly name: string;
  /** The material the part is made of (Blender material and glTF material name). */
  readonly material: string;
  readonly profile: readonly (readonly [number, number])[];
}

export const CUE_LENGTH = 58 * IN;
/** Tip diameter 13 mm, domed to a nickel's radius (pooltool's tip radius). */
export const TIP_RADIUS = 0.0065;
export const TIP_DOME_RADIUS = 0.0106045;
const TIP_HEIGHT = 0.006;
const FERRULE = 0.75 * IN;
/** Where the shaft stops being straight (pro taper: 12 in from the tip) and the joint. */
const TAPER_START = 12 * IN;
const JOINT = 29 * IN;
const SHAFT_AT_JOINT = 0.0107;

/** The dome's sag at the tip's edge. */
const DOME_SAG = TIP_DOME_RADIUS - Math.sqrt(TIP_DOME_RADIUS ** 2 - TIP_RADIUS ** 2);

function dome(): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= 6; i++) {
    const r = (TIP_RADIUS * i) / 6;
    out.push([TIP_DOME_RADIUS - Math.sqrt(TIP_DOME_RADIUS ** 2 - r * r), r]);
  }
  return out;
}

const tipEnd = TIP_HEIGHT;
const ferruleEnd = tipEnd + FERRULE;

export const CUE_PARTS: readonly CuePart[] = [
  { name: 'tip', material: 'cue-tip', profile: [...dome(), [tipEnd, TIP_RADIUS], [tipEnd, 0]] },
  {
    name: 'ferrule',
    material: 'cue-ferrule',
    profile: [
      [tipEnd, 0],
      [tipEnd, TIP_RADIUS],
      [ferruleEnd, TIP_RADIUS + 0.00005],
      [ferruleEnd, 0],
    ],
  },
  {
    name: 'shaft',
    material: 'cue-shaft',
    profile: [
      [ferruleEnd, 0],
      [ferruleEnd, TIP_RADIUS + 0.00005],
      [TAPER_START, TIP_RADIUS + 0.0001],
      [TAPER_START + 6 * IN, 0.0079],
      [JOINT - 0.6 * IN, SHAFT_AT_JOINT - 0.0001],
      [JOINT - 0.6 * IN, 0],
    ],
  },
  {
    name: 'collar',
    material: 'cue-collar',
    profile: [
      [JOINT - 0.6 * IN, 0],
      [JOINT - 0.6 * IN, SHAFT_AT_JOINT],
      [JOINT + 0.75 * IN, 0.011],
      [JOINT + 0.75 * IN, 0],
    ],
  },
  {
    name: 'forearm',
    material: 'cue-forearm',
    profile: [
      [JOINT + 0.75 * IN, 0],
      [JOINT + 0.75 * IN, 0.011],
      [41 * IN, 0.0135],
      [41 * IN, 0],
    ],
  },
  {
    name: 'ring',
    material: 'cue-ring',
    profile: [
      [41 * IN, 0],
      [41 * IN, 0.0137],
      [41.3 * IN, 0.0138],
      [41.3 * IN, 0],
    ],
  },
  {
    name: 'wrap',
    material: 'cue-wrap',
    profile: [
      [41.3 * IN, 0],
      [41.3 * IN, 0.0141],
      [51.8 * IN, 0.0145],
      [51.8 * IN, 0],
    ],
  },
  {
    name: 'ring-2',
    material: 'cue-ring',
    profile: [
      [51.8 * IN, 0],
      [51.8 * IN, 0.0146],
      [52.1 * IN, 0.0147],
      [52.1 * IN, 0],
    ],
  },
  {
    name: 'sleeve',
    material: 'cue-sleeve',
    profile: [
      [52.1 * IN, 0],
      [52.1 * IN, 0.0147],
      [57 * IN, 0.0159],
      [57 * IN, 0],
    ],
  },
  {
    name: 'butt-cap',
    material: 'cue-cap',
    profile: [
      [57 * IN, 0],
      [57 * IN, 0.0159],
      [57.75 * IN, 0.0159],
      [57.75 * IN, 0],
    ],
  },
  {
    name: 'bumper',
    material: 'cue-bumper',
    profile: [
      [57.75 * IN, 0],
      [57.75 * IN, 0.014],
      [57.9 * IN, 0.0138],
      [CUE_LENGTH, 0.012],
      [CUE_LENGTH, 0],
    ],
  },
];

/** How far behind the tip's centre the dome's edge lies (for setting the tip against a ball). */
export const TIP_SAG = DOME_SAG;
