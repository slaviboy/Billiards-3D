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

// The table on screen: the model made in Blender (public/models/table-<size>.glb), which is already
// in the scene's frame, with the game's own cloth, wood, leather and nets. Both sizes are loaded on
// demand and kept, so changing tables between racks is instant.

import {
  type Color,
  Group,
  type Material,
  type Mesh,
  type MeshPhysicalMaterial,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { TableSize } from '../table/spec.ts';
import {
  clothMaterial,
  type ClothName,
  leatherMaterial,
  netMaterial,
  woodMaterial,
} from './surfaces.ts';

export class TableView {
  readonly group = new Group();
  private readonly loader = new GLTFLoader();
  private readonly models = new Map<TableSize, Promise<Object3D>>();
  private shown: Object3D | null = null;
  private cloth: MeshPhysicalMaterial = clothMaterial();
  private readonly surfaces = new Map<string, Material>();

  constructor(private readonly baseUrl: string) {
    this.group.name = 'table';
  }

  /** Shows the table of this size, loading it the first time. */
  async show(size: TableSize): Promise<void> {
    const model = await this.load(size);
    if (this.shown) this.group.remove(this.shown);
    this.group.add(model);
    this.shown = model;
  }

  /** Changes the cloth's colour. */
  setCloth(name: ClothName): void {
    const next = clothMaterial(name);
    for (const model of this.loaded) {
      model.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh && mesh.material === this.cloth) mesh.material = next;
      });
    }
    this.cloth.dispose();
    this.cloth = next;
  }

  private readonly loaded: Object3D[] = [];

  private load(size: TableSize): Promise<Object3D> {
    let model = this.models.get(size);
    if (!model) {
      model = this.loader.loadAsync(`${this.baseUrl}models/table-${size}.glb`).then((gltf) => {
        const root = gltf.scene;
        root.name = `table-${size}`;
        root.traverse((o) => {
          const mesh = o as Mesh;
          if (!mesh.isMesh) return;
          mesh.material = this.surface(mesh.material as Material);
          const part = mesh.name.replace(/^\d+ft-/, '');
          // The cloth, cushions, rails and leathers take the shadows of balls and cue; the frame
          // casts the table's shadow on the floor, and the bed (the slate) stops the light there,
          // so nothing on the cloth throws a shadow through the table.
          mesh.receiveShadow =
            part === 'bed' || part.startsWith('cushion') || part === 'rails' || part === 'leathers';
          mesh.castShadow =
            part === 'bed' ||
            part === 'rails' ||
            part === 'apron' ||
            part === 'legs' ||
            part === 'leathers';
        });
        this.loaded.push(root);
        return root;
      });
      this.models.set(size, model);
    }
    return model;
  }

  /** The game's version of a model material, chosen by its name. */
  private surface(material: Material): Material {
    const name = material.name;
    if (name === 'cloth') {
      material.dispose();
      return this.cloth;
    }
    const make = name.endsWith('wood')
      ? (c: Color) => woodMaterial(c, name)
      : name === 'leather'
        ? leatherMaterial
        : name === 'net'
          ? netMaterial
          : null;
    if (!make) return material;
    let surface = this.surfaces.get(name);
    if (!surface) {
      surface = make((material as MeshStandardMaterial).color.clone());
      this.surfaces.set(name, surface);
    }
    material.dispose();
    return surface;
  }

  dispose(): void {
    this.cloth.dispose();
    for (const surface of this.surfaces.values()) surface.dispose();
  }
}
