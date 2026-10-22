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

// The sixteen balls on screen: one shared sphere, a material each (src/scene/ballMaterial.ts), and
// a soft contact shadow under each, the dark patch an overhead lamp leaves around a ball's foot.
// Positions come from the simulation; orientations are integrated here from its spin, so the
// numbers roll as the ball does.

import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { BALL_RADIUS } from '../table/spec.ts';
import { ballMaterial } from './ballMaterial.ts';

const R = BALL_RADIUS;

export class BallSet {
  readonly group = new Group();
  readonly meshes: Mesh[] = [];
  private readonly shadows: Mesh[] = [];
  private readonly geometry = new SphereGeometry(R, 64, 40);
  private readonly shadowGeometry = new PlaneGeometry(R * 3.4, R * 3.4);
  private readonly shadowMaterial: MeshBasicMaterial;
  private readonly axis = new Vector3();
  private readonly step = new Quaternion();

  constructor() {
    this.group.name = 'balls';
    this.shadowMaterial = new MeshBasicMaterial({
      map: contactShadowTexture(),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      opacity: 0.85,
    });
    for (let n = 0; n <= 15; n++) {
      const mesh = new Mesh(this.geometry, ballMaterial(n));
      mesh.name = `ball-${n}`;
      mesh.castShadow = true;
      this.meshes.push(mesh);
      const shadow = new Mesh(this.shadowGeometry, this.shadowMaterial);
      shadow.name = `ball-${n}-shadow`;
      shadow.rotation.x = -Math.PI / 2;
      shadow.renderOrder = 1;
      this.shadows.push(shadow);
      this.group.add(mesh, shadow);
    }
  }

  /** Places ball n at scene coordinates (its centre), with its contact shadow under it. */
  place(n: number, x: number, y: number, z: number): void {
    const mesh = this.meshes[n]!;
    mesh.position.set(x, y, z);
    const shadow = this.shadows[n]!;
    // The shadow lies on the cloth while the ball does, and fades as it drops into a pocket.
    const lift = y - R;
    shadow.visible = mesh.visible && lift > -R * 1.2;
    shadow.position.set(x, 0.0006, z);
    const fade = Math.max(0, Math.min(1, 1 + lift / (R * 1.2)));
    shadow.scale.setScalar(0.7 + 0.3 * fade);
  }

  setVisible(n: number, visible: boolean): void {
    this.meshes[n]!.visible = visible;
    this.shadows[n]!.visible = visible;
  }

  /** Turns ball n by its angular velocity (scene axes, rad/s) over dt seconds. */
  spin(n: number, wx: number, wy: number, wz: number, dt: number): void {
    const w = Math.sqrt(wx * wx + wy * wy + wz * wz);
    if (w === 0 || dt === 0) return;
    this.axis.set(wx / w, wy / w, wz / w);
    this.step.setFromAxisAngle(this.axis, w * dt);
    const q = this.meshes[n]!.quaternion;
    q.premultiply(this.step).normalize();
  }

  /** Gives every ball a random orientation (seeded), as balls lie after racking. */
  scramble(seed: number): void {
    let s = seed >>> 0 || 1;
    const random = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (const mesh of this.meshes) {
      // A uniformly random rotation (Shoemake's method).
      const u1 = random();
      const u2 = random() * Math.PI * 2;
      const u3 = random() * Math.PI * 2;
      const a = Math.sqrt(1 - u1);
      const b = Math.sqrt(u1);
      mesh.quaternion.set(a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3));
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.shadowGeometry.dispose();
    this.shadowMaterial.map?.dispose();
    this.shadowMaterial.dispose();
    for (const mesh of this.meshes) (mesh.material as { dispose(): void }).dispose();
  }
}

/** A soft round shadow: darkest under the ball, fading out a little beyond its edge. */
function contactShadowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,0.75)');
  gradient.addColorStop(0.3, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(0.55, 'rgba(0,0,0,0.18)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}
