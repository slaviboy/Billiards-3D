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

// The aiming guide: where the cue ball goes first, drawn on the cloth. Its path runs to the first
// ball or cushion it would meet, by the table's own geometry (the cushions and lips the simulation
// uses); at a ball, a ghost ball marks the contact, with the line the object ball takes (along the
// line of centres) and the line the cue ball leaves on (square to it, as a stunned ball does); at a
// cushion, the rebound's direction. It shows geometry, not the result of the shot: spin, throw and
// speed are for the player to judge.

import { Group } from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Motion, type BallState } from '../physics/index.ts';
import type { PhysicsTable } from '../physics/types.ts';
import { BALL_RADIUS } from '../table/spec.ts';

const R = BALL_RADIUS;
const LIFT = 0.0025;
const CIRCLE_STEPS = 40;

export interface GuidePrediction {
  /** Where the cue ball's centre is at first contact (table frame). */
  readonly contact: { x: number; y: number };
  /** The ball met first, or null for a cushion or a pocket. */
  readonly ball: number | null;
  /** Unit directions after contact: the object ball's, and the cue ball's. */
  readonly object: { x: number; y: number } | null;
  readonly cue: { x: number; y: number } | null;
}

/** The cue ball's first contact along a heading, by geometry alone. */
export function predict(
  balls: readonly Readonly<BallState>[],
  table: PhysicsTable,
  dx: number,
  dy: number,
): GuidePrediction {
  const c = balls[0]!;
  let best = Infinity;
  let ball: number | null = null;
  for (let i = 1; i < balls.length; i++) {
    const b = balls[i]!;
    if (b.s === Motion.Pocketed) continue;
    const ox = b.rx - c.rx;
    const oy = b.ry - c.ry;
    const along = ox * dx + oy * dy;
    if (along <= 0) continue;
    const px = ox - along * dx;
    const py = oy - along * dy;
    const off2 = px * px + py * py;
    if (off2 >= 4 * R * R) continue;
    const t = along - Math.sqrt(4 * R * R - off2);
    if (t < best) [best, ball] = [t, i];
  }
  let normal: { x: number; y: number } | null = null;
  for (const s of table.linear) {
    const toward = s.nx * dx + s.ny * dy;
    if (toward >= 0) continue;
    const t = (R - (s.nx * (c.rx - s.p1x) + s.ny * (c.ry - s.p1y))) / toward;
    if (!(t > 0 && t < best)) continue;
    const x = c.rx + t * dx;
    const y = c.ry + t * dy;
    const ux = s.p2x - s.p1x;
    const uy = s.p2y - s.p1y;
    const k = ((x - s.p1x) * ux + (y - s.p1y) * uy) / (ux * ux + uy * uy);
    if (k < 0 || k > 1) continue;
    [best, ball, normal] = [t, null, { x: s.nx, y: s.ny }];
  }
  for (const j of table.circular) {
    const ox = j.cx - c.rx;
    const oy = j.cy - c.ry;
    const along = ox * dx + oy * dy;
    const px = ox - along * dx;
    const py = oy - along * dy;
    const reach = (j.r + R) * (j.r + R) - (px * px + py * py);
    if (along <= 0 || reach < 0) continue;
    const t = along - Math.sqrt(reach);
    if (!(t > 0 && t < best)) continue;
    const x = c.rx + t * dx;
    const y = c.ry + t * dy;
    const n = Math.hypot(x - j.cx, y - j.cy);
    [best, ball, normal] = [t, null, { x: (x - j.cx) / n, y: (y - j.cy) / n }];
  }
  if (best === Infinity) best = 0;
  const contact = { x: c.rx + best * dx, y: c.ry + best * dy };
  if (ball !== null) {
    const b = balls[ball]!;
    const nx = (b.rx - contact.x) / (2 * R);
    const ny = (b.ry - contact.y) / (2 * R);
    // Square to the line of centres, on the side the cue ball was heading.
    const along = dx * nx + dy * ny;
    let tx = dx - along * nx;
    let ty = dy - along * ny;
    const tl = Math.hypot(tx, ty);
    if (tl > 1e-9) {
      tx /= tl;
      ty /= tl;
    }
    return { contact, ball, object: { x: nx, y: ny }, cue: tl > 1e-9 ? { x: tx, y: ty } : null };
  }
  if (normal) {
    // The rebound, as a mirror would send it (the cushion's friction and the spin bend it).
    const k = 2 * (dx * normal.x + dy * normal.y);
    return {
      contact,
      ball: null,
      object: null,
      cue: { x: dx - k * normal.x, y: dy - k * normal.y },
    };
  }
  return { contact, ball: null, object: null, cue: null };
}

export class AimGuide {
  readonly group = new Group();
  private readonly path: Line2;
  private readonly ghost: Line2;
  private readonly objectLine: Line2;
  private readonly cueLine: Line2;
  private readonly materials: LineMaterial[] = [];
  /** How far the after-contact lines reach, metres. */
  private reach = { object: 0.4, cue: 0.22 };

  constructor() {
    this.group.name = 'aim-guide';
    const make = (colour: number, width: number, opacity: number, dashed = false) => {
      const material = new LineMaterial({
        color: colour,
        linewidth: width,
        transparent: true,
        opacity,
        depthWrite: false,
        dashed,
        dashSize: 0.025,
        gapSize: 0.015,
      });
      this.materials.push(material);
      const line = new Line2(new LineGeometry(), material);
      line.renderOrder = 2;
      line.frustumCulled = false;
      this.group.add(line);
      return line;
    };
    this.path = make(0xffffff, 2, 0.75);
    this.ghost = make(0xffffff, 1.6, 0.85);
    this.objectLine = make(0xffe7a8, 2, 0.8);
    this.cueLine = make(0x9fd8ff, 1.6, 0.65, true);
  }

  /** Pixel size of the drawing area (fat lines are sized in pixels). */
  setResolution(width: number, height: number): void {
    for (const m of this.materials) m.resolution.set(width, height);
  }

  setLength(length: 'long' | 'short' | 'off'): void {
    this.group.visible = length !== 'off';
    this.reach = length === 'long' ? { object: 0.42, cue: 0.24 } : { object: 0.16, cue: 0.09 };
  }

  /** Marks the ghost ball red when the ball met first may not be hit first. */
  setLegal(legal: boolean): void {
    this.ghost.material.color.set(legal ? 0xffffff : 0xff6b5e);
  }

  /**
   * Draws the guide for a cue ball at its state in `balls` aiming along (dx, dy), in the table
   * frame; `toScene` maps table points to the scene.
   */
  update(
    balls: readonly Readonly<BallState>[],
    table: PhysicsTable,
    dx: number,
    dy: number,
    toScene: (x: number, y: number) => { x: number; z: number },
  ): GuidePrediction {
    const p = predict(balls, table, dx, dy);
    const c = balls[0]!;
    const at = (x: number, y: number) => {
      const s = toScene(x, y);
      return [s.x, LIFT, s.z];
    };
    setLine(this.path, [...at(c.rx + dx * R, c.ry + dy * R), ...at(p.contact.x, p.contact.y)]);
    const ring: number[] = [];
    for (let i = 0; i <= CIRCLE_STEPS; i++) {
      const a = (i / CIRCLE_STEPS) * Math.PI * 2;
      ring.push(...at(p.contact.x + Math.cos(a) * R, p.contact.y + Math.sin(a) * R));
    }
    setLine(this.ghost, ring);
    this.ghost.visible = p.ball !== null;
    const segment = (
      line: Line2,
      from: { x: number; y: number },
      dir: { x: number; y: number } | null,
      length: number,
    ) => {
      line.visible = dir !== null;
      if (dir)
        setLine(line, [
          ...at(from.x, from.y),
          ...at(from.x + dir.x * length, from.y + dir.y * length),
        ]);
    };
    if (p.ball !== null) {
      const b = balls[p.ball]!;
      segment(this.objectLine, { x: b.rx, y: b.ry }, p.object, this.reach.object);
    } else {
      this.objectLine.visible = false;
    }
    segment(this.cueLine, p.contact, p.cue, this.reach.cue);
    return p;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  set visible(visible: boolean) {
    this.group.visible = visible;
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
    for (const line of [this.path, this.ghost, this.objectLine, this.cueLine])
      line.geometry.dispose();
  }
}

function setLine(line: Line2, points: number[]): void {
  line.geometry.setPositions(points);
  line.computeLineDistances();
}
