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

// The two ways of looking at the table, over one scene:
//
//   3d   a perspective camera orbiting the table, by default from behind the head rail, framed to
//        fit the part of the screen the interface leaves free; the player may turn, tilt and zoom.
//   top  an orthographic camera straight down, no perspective at all, the table lengthwise on a
//        wide screen and upright on a tall one.
//
// Switching is a dolly zoom: the perspective camera rises overhead while its field of view narrows
// and it backs away, keeping the table the same size, until it is all but orthographic; then the
// orthographic camera takes over with the same framing. Back again the other way. The game and its
// state are untouched; only the camera moves.

import { MathUtils, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';

export type ViewMode = '3d' | 'top';

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

interface Orbit {
  azimuth: number;
  elevation: number;
  /** Distance as a multiple of the distance that just fits the table. */
  zoom: number;
  targetX: number;
  targetZ: number;
}

const DEG = Math.PI / 180;
const FOV = 38;
/** The field of view the switch to the top view narrows to before handing over. */
const NEAR_ORTHO_FOV = 3;
const MARGIN = 0.94;
const TRANSITION_SECONDS = 0.9;
const MIN_ELEVATION = 10 * DEG;
const MAX_ELEVATION = 88 * DEG;

const HOME: Orbit = { azimuth: 0, elevation: 42 * DEG, zoom: 1, targetX: 0, targetZ: 0 };

export class CameraRig {
  readonly perspective = new PerspectiveCamera(FOV, 1, 0.05, 60);
  readonly ortho = new OrthographicCamera(-1, 1, 1, -1, 0.05, 30);
  private width = 1;
  private height = 1;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** Half extents of what must stay in view (the table to the rails' outer edges), metres. */
  private halfX = 0.8;
  private halfZ = 1.45;
  private mode: ViewMode = '3d';
  private goal: Orbit = { ...HOME };
  private current: Orbit = { ...HOME };
  /** 0: fully 3D, 1: fully top; moves toward the mode. */
  private blend = 0;
  private readonly corners: Vector3[] = [];
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();

  constructor(private readonly requestRender: () => void) {}

  /** The camera to draw with now. */
  get camera(): PerspectiveCamera | OrthographicCamera {
    return this.blend >= 1 ? this.ortho : this.perspective;
  }

  get view(): ViewMode {
    return this.mode;
  }

  get moving(): boolean {
    return this.blend !== (this.mode === 'top' ? 1 : 0) || !same(this.current, this.goal);
  }

  /** The table to keep in view: its outer half width and half length, and the rails' height. */
  setTable(halfX: number, halfZ: number): void {
    this.halfX = halfX;
    this.halfZ = halfZ;
    this.corners.length = 0;
    for (const x of [-halfX, halfX]) {
      for (const z of [-halfZ, halfZ]) {
        for (const y of [-0.17, 0.05]) this.corners.push(new Vector3(x, y, z));
      }
    }
    this.apply();
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.apply();
  }

  /** Space the interface covers at each edge, in CSS pixels; the table is framed in the rest. */
  setInsets(insets: Insets): void {
    this.insets = { ...insets };
    this.apply();
  }

  setView(mode: ViewMode, immediate = false): void {
    this.mode = mode;
    if (immediate) this.blend = mode === 'top' ? 1 : 0;
    this.requestRender();
  }

  /** Back to the view from behind the head rail. */
  home(): void {
    this.goal = { ...HOME };
    this.requestRender();
  }

  /** Turns and tilts the 3D view by these angles (radians). */
  orbit(dAzimuth: number, dElevation: number): void {
    this.goal.azimuth += dAzimuth;
    this.goal.elevation = MathUtils.clamp(
      this.goal.elevation + dElevation,
      MIN_ELEVATION,
      MAX_ELEVATION,
    );
    this.requestRender();
  }

  /** Zooms the 3D view by a factor (below 1 closer). */
  zoom(factor: number): void {
    this.goal.zoom = MathUtils.clamp(this.goal.zoom * factor, 0.35, 1.35);
    this.requestRender();
  }

  /** Per frame: eases toward the goal; true while still moving. */
  update(dt: number): boolean {
    const k = 1 - Math.exp(-10 * dt);
    for (const key of ['azimuth', 'elevation', 'zoom', 'targetX', 'targetZ'] as const) {
      this.current[key] += (this.goal[key] - this.current[key]) * k;
      if (Math.abs(this.goal[key] - this.current[key]) < 1e-5) this.current[key] = this.goal[key];
    }
    const target = this.mode === 'top' ? 1 : 0;
    if (this.blend !== target) {
      const step = dt / TRANSITION_SECONDS;
      this.blend =
        target > this.blend ? Math.min(1, this.blend + step) : Math.max(0, this.blend - step);
    }
    const moving = this.moving;
    this.apply();
    return moving;
  }

  /** Whether the free area is wider than tall (then the top view lays the table lengthwise). */
  private get landscape(): boolean {
    const { top, right, bottom, left } = this.insets;
    return this.width - left - right >= this.height - top - bottom;
  }

  private apply(): void {
    const { top, right, bottom, left } = this.insets;
    const freeW = Math.max(1, this.width - left - right);
    const freeH = Math.max(1, this.height - top - bottom);
    // Shift the picture so the table centres in the free area.
    const shiftX = -(left - right) / 2;
    const shiftY = -(top - bottom) / 2;

    // The top view's orbit: straight down, the screen's up along the table (portrait) or across.
    const topAzimuth = this.landscape ? 90 * DEG : 0;
    const t = smooth(this.blend);
    const azimuth = mixAngle(this.current.azimuth, topAzimuth, t);
    const elevation = this.current.elevation + (90 * DEG - 1e-4 - this.current.elevation) * t;
    const fov = FOV + (NEAR_ORTHO_FOV - FOV) * t;
    const zoom = this.current.zoom + (1 - this.current.zoom) * t;
    const tx = this.current.targetX * (1 - t);
    const tz = this.current.targetZ * (1 - t);

    const tanHalf = Math.tan((fov * DEG) / 2);
    const distance = this.fitDistance(azimuth, elevation, tanHalf, freeW, freeH) * zoom;
    const camera = this.perspective;
    camera.fov = fov;
    camera.aspect = this.width / this.height;
    camera.near = Math.max(0.02, distance * 0.05);
    camera.far = distance + 12;
    const ce = Math.cos(elevation);
    camera.position.set(
      tx + Math.sin(azimuth) * ce * distance,
      Math.sin(elevation) * distance,
      tz + Math.cos(azimuth) * ce * distance,
    );
    // "Up" on screen is away from the camera along the cloth, which stays defined overhead.
    camera.up.set(-Math.sin(azimuth), 0, -Math.cos(azimuth));
    camera.lookAt(tx, 0, tz);
    camera.setViewOffset(this.width, this.height, shiftX, shiftY, this.width, this.height);
    camera.updateProjectionMatrix();

    // The orthographic camera, framed the same way.
    const ortho = this.ortho;
    const landscape = this.landscape;
    const along = landscape ? this.halfZ : this.halfX; // extent across the screen
    const across = landscape ? this.halfX : this.halfZ; // extent up the screen
    const scale = Math.min((freeW * MARGIN) / (2 * along), (freeH * MARGIN) / (2 * across));
    const halfH = this.height / (2 * scale);
    const halfW = halfH * (this.width / this.height);
    ortho.left = -halfW;
    ortho.right = halfW;
    ortho.top = halfH;
    ortho.bottom = -halfH;
    ortho.position.set(0, 10, 0);
    ortho.up.set(landscape ? -1 : 0, 0, landscape ? 0 : -1);
    ortho.lookAt(0, 0, 0);
    ortho.setViewOffset(this.width, this.height, shiftX, shiftY, this.width, this.height);
    ortho.updateProjectionMatrix();
    this.requestRender();
  }

  /**
   * The distance at which the table, seen from this direction, just fits the free area: for each
   * corner of the table's box, how far back the camera must be to see it inside the margin.
   */
  private fitDistance(
    azimuth: number,
    elevation: number,
    tanHalf: number,
    freeW: number,
    freeH: number,
  ): number {
    const ce = Math.cos(elevation);
    // From the camera toward the target.
    this.forward.set(-Math.sin(azimuth) * ce, -Math.sin(elevation), -Math.cos(azimuth) * ce);
    this.up.set(-Math.sin(azimuth), 0, -Math.cos(azimuth));
    this.right.crossVectors(this.forward, this.up).normalize();
    this.up.crossVectors(this.right, this.forward).normalize();
    const kx = (tanHalf * freeW * MARGIN) / this.height;
    const ky = (tanHalf * freeH * MARGIN) / this.height;
    let d = 0.5;
    for (const corner of this.corners) {
      const px = corner.dot(this.right);
      const py = corner.dot(this.up);
      const pz = corner.dot(this.forward);
      d = Math.max(d, Math.abs(px) / kx - pz, Math.abs(py) / ky - pz);
    }
    return d;
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Interpolates angles the short way round. */
function mixAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

function same(a: Orbit, b: Orbit): boolean {
  return (
    a.azimuth === b.azimuth &&
    a.elevation === b.elevation &&
    a.zoom === b.zoom &&
    a.targetX === b.targetX &&
    a.targetZ === b.targetZ
  );
}
