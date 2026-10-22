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

// The exported models match the simulation: every cushion vertex at nose height lies on the
// outline the balls bounce off, and the nose runs the full length of every cushion piece. Also
// checks the files are valid glTF 2.0 of a sensible size, with the parts the game looks for.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTable } from '../../src/table/geometry.ts';
import { TABLE_SIZES, tableSpec } from '../../src/table/spec.ts';
import { CUE_LENGTH } from '../../src/cue/spec.ts';

const root = join(import.meta.dirname, '..', '..');

interface Gltf {
  asset: { version: string };
  nodes: {
    name: string;
    mesh?: number;
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
  meshes: { primitives: { attributes: { POSITION: number }; indices?: number }[] }[];
  accessors: {
    bufferView: number;
    byteOffset?: number;
    count: number;
    type: string;
    componentType: number;
  }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
}

function readGlb(file: string): { json: Gltf; bin: Buffer } {
  const data = readFileSync(join(root, 'public', 'models', file));
  expect(data.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
  expect(data.readUInt32LE(4)).toBe(2);
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.toString('utf8', 20, 20 + jsonLength)) as Gltf;
  const binStart = 20 + jsonLength;
  const bin = data.subarray(binStart + 8, binStart + 8 + data.readUInt32LE(binStart));
  return { json, bin };
}

/** Every vertex position of a node's mesh, in glTF coordinates. */
function positions(gltf: { json: Gltf; bin: Buffer }, node: Gltf['nodes'][number]): number[][] {
  const out: number[][] = [];
  for (const primitive of gltf.json.meshes[node.mesh!]!.primitives) {
    const accessor = gltf.json.accessors[primitive.attributes.POSITION]!;
    const view = gltf.json.bufferViews[accessor.bufferView]!;
    const stride = view.byteStride ?? 12;
    const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    for (let i = 0; i < accessor.count; i++) {
      const at = base + i * stride;
      out.push([
        gltf.bin.readFloatLE(at),
        gltf.bin.readFloatLE(at + 4),
        gltf.bin.readFloatLE(at + 8),
      ]);
    }
  }
  return out;
}

function triangles(gltf: { json: Gltf }): number {
  let count = 0;
  for (const mesh of gltf.json.meshes) {
    for (const p of mesh.primitives) {
      const accessor = gltf.json.accessors[p.indices ?? p.attributes.POSITION]!;
      count += accessor.count / 3;
    }
  }
  return count;
}

const isIdentity = (node: Gltf['nodes'][number]) =>
  (!node.translation || node.translation.every((v) => v === 0)) &&
  (!node.rotation || (node.rotation[3] === 1 && node.rotation.slice(0, 3).every((v) => v === 0))) &&
  (!node.scale || node.scale.every((v) => v === 1));

describe.each(TABLE_SIZES)('the %s table model', (size) => {
  const gltf = readGlb(`table-${size}.glb`);
  const spec = tableSpec(size);
  const table = buildTable(spec).physics;
  const { W, L, noseHeight: h } = spec;

  it('is glTF 2.0 with the parts the game uses, each placed at the origin', () => {
    expect(gltf.json.asset.version).toBe('2.0');
    const names = gltf.json.nodes.map((n) => n.name);
    for (const part of ['bed', 'rails', 'liners', 'pockets', 'sights', 'apron', 'legs', 'spot']) {
      expect(names).toContain(`${size}-${part}`);
    }
    for (let rail = 0; rail < 6; rail++) expect(names).toContain(`${size}-cushion-${rail}`);
    for (const node of gltf.json.nodes) expect(isIdentity(node), node.name).toBe(true);
    expect(triangles(gltf)).toBeLessThan(60000);
  });

  it('puts every cushion vertex at nose height on the outline the balls bounce off', () => {
    let worst = 0;
    let count = 0;
    const noses: number[][] = [];
    for (const node of gltf.json.nodes.filter((n) => /-cushion-\d$/.test(n.name))) {
      for (const [X, Y, Z] of positions(gltf, node)) {
        if (Math.abs(Y! - h) > 1e-5) continue;
        // glTF (scene) to the table frame.
        const x = X! + W / 2;
        const y = L / 2 - Z!;
        noses.push([x, y]);
        let d = Infinity;
        for (const s of table.linear)
          d = Math.min(d, segmentDistance(x, y, s.p1x, s.p1y, s.p2x, s.p2y));
        for (const c of table.circular)
          d = Math.min(d, Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r));
        worst = Math.max(worst, d);
        count++;
      }
    }
    expect(count).toBeGreaterThan(6 * 20);
    expect(worst).toBeLessThan(1e-4);
    // And the nose reaches both ends of every straight cushion: the drawn rubber covers the lines.
    for (const s of table.linear) {
      for (const [x, y] of [
        [s.p1x, s.p1y],
        [s.p2x, s.p2y],
      ] as const) {
        const nearest = Math.min(...noses.map(([nx, ny]) => Math.hypot(nx! - x, ny! - y)));
        expect(nearest).toBeLessThan(1e-4);
      }
    }
  });
});

describe('the cue model', () => {
  const gltf = readGlb('cue.glb');

  it("is one node, tip at the origin, running up +Y for the cue's length", () => {
    const node = gltf.json.nodes.find((n) => n.name === 'cue')!;
    expect(isIdentity(node)).toBe(true);
    const ys = positions(gltf, node).map((p) => p[1]!);
    expect(Math.min(...ys)).toBeCloseTo(0, 5);
    expect(Math.max(...ys)).toBeCloseTo(CUE_LENGTH, 4);
    expect(triangles(gltf)).toBeLessThan(20000);
  });
});

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
