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

// Shows that the cue ball is in hand: a ring on the cloth round it, saying it can be picked up and
// moved, and, while it must stay behind the head string (the break, some fouls), that line drawn
// across the table.

import { DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry } from 'three';
import { BALL_RADIUS } from '../table/spec.ts';

const R = BALL_RADIUS;
/** Just above the cloth, so the marks never flicker into it. */
const LIFT = 0.0015;

export class InHandMarker {
  readonly group = new Group();
  private readonly ring: Mesh;
  private readonly line: Mesh;
  private readonly materials: MeshBasicMaterial[] = [];

  constructor() {
    this.group.name = 'in-hand';
    const material = (opacity: number) => {
      const m = new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity,
        depthWrite: false,
        side: DoubleSide,
      });
      this.materials.push(m);
      return m;
    };
    this.ring = new Mesh(new RingGeometry(1.3 * R, 1.5 * R, 48), material(0.55));
    this.ring.rotation.x = -Math.PI / 2;
    this.line = new Mesh(new PlaneGeometry(1, 0.003), material(0.4));
    this.line.rotation.x = -Math.PI / 2;
    for (const mesh of [this.ring, this.line]) {
      mesh.renderOrder = 1;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.group.visible = false;
  }

  /**
   * Places the marks for a cue ball in hand at (x, z) in the scene; `headString`, the line's z, when
   * the ball must stay behind it, with the table's width between the cushions.
   */
  show(x: number, z: number, headString: { z: number; width: number } | null): void {
    this.group.visible = true;
    this.ring.position.set(x, LIFT, z);
    this.line.visible = headString !== null;
    if (headString) {
      this.line.position.set(0, LIFT, headString.z);
      this.line.scale.x = headString.width;
    }
  }

  hide(): void {
    this.group.visible = false;
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
    this.ring.geometry.dispose();
    this.line.geometry.dispose();
  }
}
