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

// The balls' material: glossy phenolic under a clear coat, with the markings drawn per pixel from
// the ball's own surface direction, by the definition in src/balls/markings.ts: the colour, the
// stripe's band, the two number discs and the number's strokes, edges smoothed by the screen-space
// width of a pixel. Nothing is a texture, so the numbers stay sharp however close the camera comes
// and turn with the ball. All sixteen materials share one compiled program; only uniforms differ.

import { Color, MeshPhysicalMaterial, Vector4 } from 'three';
import {
  BALL_COLORS,
  BALL_INK,
  BALL_WHITE,
  DISC_COS,
  discNumber,
  hasNumber,
  isStripe,
  RIM_COS,
  STRIPE_SIN,
} from '../balls/markings.ts';

/** The most line segments any number has (the 8: two loops). */
export const MAX_SEGMENTS = 48;

const VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vBallDirection;
`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
varying vec3 vBallDirection;
uniform vec3 uBallColor;
uniform vec3 uBallWhite;
uniform vec3 uBallInk;
uniform float uStripe;
uniform float uNumbered;
uniform float uDiscCos;
uniform float uRimCos;
uniform float uStripeSin;
uniform float uHalfWidth;
uniform int uSegmentCount;
uniform vec4 uSegments[${MAX_SEGMENTS}];

float segmentDistance(vec2 p, vec4 s) {
  vec2 a = s.xy;
  vec2 b = s.zw - a;
  float t = clamp(dot(p - a, b) / max(dot(b, b), 1e-12), 0.0, 1.0);
  return length(p - a - b * t);
}

vec3 ballMarking(vec3 n) {
  // Screen-space derivatives first, while every pixel still runs the same code.
  float facing = abs(n.z);
  // The point on the facing disc's tangent plane (gnomonic projection), in units of the radius;
  // +Z reads upright, -Z upside down (WPA: one of the two numbers inverted).
  vec2 p = vec2(n.x, n.z >= 0.0 ? n.y : -n.y) / max(facing, 0.05);
  float wy = fwidth(n.y) * 0.75;
  float wf = fwidth(facing) * 0.75;
  vec2 fp = fwidth(p);
  float wd = 0.75 * max(fp.x, fp.y);

  vec3 colour = uBallColor;
  // The band of a stripe: white caps beyond ±uStripeSin of the axis (+Y).
  if (uStripe > 0.5) colour = mix(uBallColor, uBallWhite, smoothstep(-wy, wy, abs(n.y) - uStripeSin));
  if (uNumbered < 0.5) return colour;
  float inDisc = smoothstep(uDiscCos - wf, uDiscCos + wf, facing);
  if (inDisc <= 0.0) return colour;
  float onRim = 1.0 - smoothstep(uRimCos - wf, uRimCos + wf, facing);
  vec3 disc = mix(uBallWhite, uBallInk, 0.55 * onRim);
  float d = 1e3;
  for (int i = 0; i < ${MAX_SEGMENTS}; i++) {
    if (i >= uSegmentCount) break;
    d = min(d, segmentDistance(p, uSegments[i]));
  }
  float ink = 1.0 - smoothstep(uHalfWidth - wd, uHalfWidth + wd, d);
  disc = mix(disc, uBallInk, ink * (1.0 - onRim));
  return mix(colour, disc, inDisc);
}
`;

function linear(hex: string): Color {
  return new Color(hex); // three converts sRGB hex to the working (linear) colour space
}

/** The material of ball `n` (0 is the cue ball). */
export function ballMaterial(n: number): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.14,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
    specularIntensity: 0.6,
    envMapIntensity: 0.9,
  });
  material.name = `ball-${n}`;
  const segments: Vector4[] = [];
  let halfWidth = 0;
  if (hasNumber(n)) {
    const number = discNumber(n);
    for (let i = 0; i < number.segments.length; i += 4) {
      const s = number.segments;
      segments.push(new Vector4(s[i], s[i + 1], s[i + 2], s[i + 3]));
    }
    halfWidth = number.halfWidth;
  }
  if (segments.length > MAX_SEGMENTS) throw new Error(`ball ${n}: too many strokes`);
  while (segments.length < MAX_SEGMENTS) segments.push(new Vector4());
  const uniforms = {
    uBallColor: { value: linear(BALL_COLORS[n]!) },
    uBallWhite: { value: linear(BALL_WHITE) },
    uBallInk: { value: linear(BALL_INK) },
    uStripe: { value: isStripe(n) ? 1 : 0 },
    uNumbered: { value: hasNumber(n) ? 1 : 0 },
    uDiscCos: { value: DISC_COS },
    uRimCos: { value: RIM_COS },
    uStripeSin: { value: STRIPE_SIN },
    uHalfWidth: { value: halfWidth },
    uSegmentCount: { value: hasNumber(n) ? discNumber(n).segments.length / 4 : 0 },
    uSegments: { value: segments },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      VERTEX_DECLARATIONS +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vBallDirection = normalize(position);',
      );
    shader.fragmentShader =
      FRAGMENT_DECLARATIONS +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n  diffuseColor.rgb *= ballMarking(normalize(vBallDirection));',
      );
  };
  material.customProgramCacheKey = () => 'pool-ball';
  return material;
}
