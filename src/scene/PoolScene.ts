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

// Owns the renderer, the lights and the render loop. Frames are drawn only when something changed
// or an animation is running, so a table at rest costs nothing.

import {
  Color,
  DirectionalLight,
  HemisphereLight,
  NeutralToneMapping,
  PCFShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Timer,
  WebGLRenderer,
  type Camera,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Called every frame with the elapsed seconds; returns true while it still needs frames. */
export type FrameUpdater = (deltaSeconds: number) => boolean;

/** The dark room around the table. */
const ROOM_COLOUR = new Color('#0d0f12');

export class PoolScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  /** The camera frames are drawn with; the camera rig swaps it between perspective and top view. */
  camera: Camera = new PerspectiveCamera(40, 1, 0.05, 60);
  private readonly updaters = new Set<FrameUpdater>();
  private readonly resizeListeners = new Set<(width: number, height: number) => void>();
  private readonly timer = new Timer();
  private dirty = true;
  private readonly resizeObserver: ResizeObserver;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = 'scene-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene.background = ROOM_COLOUR.clone();
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.2;
    pmrem.dispose();

    this.scene.add(new HemisphereLight('#fff3e2', '#1b2a1f', 0.5));
    const key = new DirectionalLight('#fff6ea', 2.5);
    key.position.set(0.6, 3, 0.4);
    this.scene.add(key);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.timer.connect(document);
    this.renderer.setAnimationLoop((time) => this.tick(time));
  }

  /** Registers a per-frame update; returns a function that removes it. */
  addUpdater(updater: FrameUpdater): () => void {
    this.updaters.add(updater);
    this.requestRender();
    return () => this.updaters.delete(updater);
  }

  onResize(listener: (width: number, height: number) => void): void {
    this.resizeListeners.add(listener);
    listener(this.width, this.height);
  }

  requestRender(): void {
    this.dirty = true;
  }

  get width(): number {
    return Math.max(1, this.container.clientWidth);
  }

  get height(): number {
    return Math.max(1, this.container.clientHeight);
  }

  /** Renders a frame now, regardless of the dirty flag (used before screenshots). */
  renderNow(): void {
    this.renderer.render(this.scene, this.camera);
    this.dirty = false;
  }

  private resize(): void {
    this.renderer.setSize(this.width, this.height, false);
    for (const listener of this.resizeListeners) listener(this.width, this.height);
    this.requestRender();
  }

  private tick(time: number): void {
    this.timer.update(time);
    const delta = Math.min(this.timer.getDelta(), 0.1);
    let active = false;
    for (const update of this.updaters) {
      if (update(delta)) active = true;
    }
    if (active || this.dirty) this.renderNow();
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.timer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
