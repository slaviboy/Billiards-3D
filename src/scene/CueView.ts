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

// The cue on screen: the turned model from Blender (public/models/cue.glb), its tip at the origin
// and its length along +Y. It is placed by where the tip meets the cue ball: on the aim line, at
// the chosen offset from the ball's centre, tilted up by the cue's elevation, and drawn back by
// the stroke's pull.

import { Group, type Mesh, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BALL_RADIUS } from '../table/spec.ts';

const R = BALL_RADIUS;
const UP = new Vector3(0, 1, 0);

export interface CuePose {
  /** The cue ball's centre, in scene coordinates. */
  readonly ball: Vector3;
  /** The aim heading as a unit vector on the cloth (scene x, z). */
  readonly dirX: number;
  readonly dirZ: number;
  /** The cue's elevation above the horizontal, radians. */
  readonly elevation: number;
  /** Tip offset from the ball's centre in units of R: a to the shooter's left, b up. */
  readonly a: number;
  readonly b: number;
  /** How far the tip stands back from the ball, metres. */
  readonly gap: number;
}

export class CueView {
  readonly group = new Group();
  private readonly back = new Vector3();
  private readonly tip = new Vector3();
  private readonly rotation = new Quaternion();
  ready: Promise<void>;

  constructor(baseUrl: string) {
    this.group.name = 'cue';
    this.group.visible = false;
    this.ready = new GLTFLoader().loadAsync(`${baseUrl}models/cue.glb`).then((gltf) => {
      gltf.scene.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh) mesh.castShadow = true;
      });
      this.group.add(gltf.scene);
    });
  }

  set visible(visible: boolean) {
    this.group.visible = visible;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  /** Places the cue for a shot. */
  pose(p: CuePose): void {
    const ce = Math.cos(p.elevation);
    const se = Math.sin(p.elevation);
    // From the tip back along the cue: against the aim, and up by the elevation.
    this.back.set(-p.dirX * ce, se, -p.dirZ * ce);
    // The contact point on the ball: across the aim by a (left of the shooter is +a), up by b.
    // Left of the aim (dirX, dirZ) on the cloth, seen from above with y up, is (dirZ, −dirX).
    const across = p.a * R;
    const up = p.b * R;
    const reach = Math.sqrt(Math.max(0, R * R - across * across - up * up));
    this.tip
      .copy(p.ball)
      .addScaledVector(new Vector3(p.dirZ, 0, -p.dirX), across)
      .add(new Vector3(0, up, 0))
      .addScaledVector(new Vector3(p.dirX, 0, p.dirZ), -reach)
      .addScaledVector(this.back, p.gap);
    this.rotation.setFromUnitVectors(UP, this.back);
    this.group.position.copy(this.tip);
    this.group.quaternion.copy(this.rotation);
  }
}
