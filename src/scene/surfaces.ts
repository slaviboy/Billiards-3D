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

// The table's surfaces, which the models carry only as plain colours (blender/scripts/materials.py):
// the cloth gets a felt's soft sheen and a faint mottle, the wood a lacquered grain running along
// each rail. Both are drawn from the world position, so the models need no texture coordinates.

import { Color, MeshPhysicalMaterial, SRGBColorSpace } from 'three';

/** Cloth colours a player can choose (WPA 12 allows yellow-green, blue-green, electric blue). */
export const CLOTHS = {
  blueGreen: '#12574f',
  yellowGreen: '#2f6a22',
  electricBlue: '#174a86',
} as const;
export type ClothName = keyof typeof CLOTHS;

const NOISE = /* glsl */ `
float poolHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float poolNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(poolHash(i), poolHash(i + vec3(1, 0, 0)), f.x),
                 mix(poolHash(i + vec3(0, 1, 0)), poolHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(poolHash(i + vec3(0, 0, 1)), poolHash(i + vec3(1, 0, 1)), f.x),
                 mix(poolHash(i + vec3(0, 1, 1)), poolHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

function withWorldPosition(material: MeshPhysicalMaterial, colourCode: string, key: string) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPoolWorld;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n  vPoolWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPoolWorld;\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${colourCode}`);
  };
  material.customProgramCacheKey = () => key;
}

/** The felt: matte, a sheen at grazing angles, and a mottle a few hand-widths across. */
export function clothMaterial(name: ClothName = 'blueGreen'): MeshPhysicalMaterial {
  const colour = new Color().setStyle(CLOTHS[name], SRGBColorSpace);
  const material = new MeshPhysicalMaterial({
    color: colour,
    roughness: 0.93,
    metalness: 0,
    sheen: 0.8,
    sheenRoughness: 0.55,
    sheenColor: colour.clone().lerp(new Color(1, 1, 1), 0.35),
    envMapIntensity: 0.35,
  });
  material.name = 'cloth';
  withWorldPosition(
    material,
    /* glsl */ `
  float mottle = poolNoise(vPoolWorld * 7.0) * 0.6 + poolNoise(vPoolWorld * 31.0) * 0.4;
  diffuseColor.rgb *= 0.95 + 0.08 * mottle;`,
    'pool-cloth',
  );
  return material;
}

/** Lacquered wood: grain along the length of each rail, under a clear coat. */
export function woodMaterial(base: Color, name: string): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial({
    color: base,
    roughness: 0.62,
    metalness: 0,
    // A satin lacquer: a mirror finish would show the lamps across whole rails from above.
    clearcoat: 0.3,
    clearcoatRoughness: 0.38,
    envMapIntensity: 0.6,
  });
  material.name = name;
  withWorldPosition(
    material,
    /* glsl */ `
  // The rails along the table's sides run in z, the end rails in x: grain follows the longer one.
  vec3 q = abs(vPoolWorld.x) > abs(vPoolWorld.z) * 0.5 ? vPoolWorld.zyx : vPoolWorld;
  float warp = poolNoise(q * vec3(1.5, 40.0, 40.0)) * 2.0 + poolNoise(q * vec3(0.6, 9.0, 9.0)) * 3.0;
  float grain = 0.5 + 0.5 * sin((q.y * 260.0 + q.z * 90.0) + warp * 3.0);
  float pores = poolNoise(q * vec3(4.0, 700.0, 700.0));
  diffuseColor.rgb *= mix(0.78, 1.12, grain) * (0.94 + 0.06 * pores);`,
    'pool-wood',
  );
  return material;
}
