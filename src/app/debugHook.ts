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

// window.__poolDebug: what the end-to-end tests drive and read, without going through the
// interface for everything. It exposes the table's fingerprint and playing a shot from its integer
// code, nothing an opponent could use against the player (online games remove it, as the chess
// game does).

import type { ShotCode } from '../game/shotCodec.ts';
import type { ViewMode } from '../scene/CameraRig.ts';
import type { App } from './App.ts';

export interface PoolDebug {
  hash(): string;
  shoot(code?: ShotCode): Promise<string>;
  setView(mode: ViewMode, immediate?: boolean): void;
  view(): ViewMode;
  setPlaybackSpeed(speed: number): void;
  render(): void;
  cueBall(): { x: number; y: number };
}

declare global {
  interface Window {
    __poolDebug?: PoolDebug;
  }
}

export function installDebugHook(app: App): void {
  window.__poolDebug = {
    hash: () => app.hash(),
    async shoot(code) {
      await app.shoot(code);
      return app.hash();
    },
    setView: (mode, immediate) => app.setView(mode, immediate),
    view: () => app.rig.view,
    setPlaybackSpeed(speed) {
      app.player.speed = speed;
    },
    render: () => app.scene.renderNow(),
    cueBall: () => ({ x: app.state[0]!.rx, y: app.state[0]!.ry }),
  };
}

export function removeDebugHook(): void {
  delete window.__poolDebug;
}
