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
// interface for everything. It exposes the table's fingerprint, the match's progress and playing a
// shot from its integer code, nothing an opponent could use against the player (online games
// remove it, as the chess game does).

import type { ShotCode } from '../game/shotCodec.ts';
import { Motion } from '../physics/index.ts';
import type { Group, Seat } from '../rules/types.ts';
import type { ViewMode } from '../scene/CameraRig.ts';
import type { UiRoot } from '../ui/UiRoot.ts';
import type { App } from './App.ts';

export interface PoolDebug {
  hash(): string;
  /** Plays a shot as the player at the table would (the interface follows up as after any shot);
   * resolves with the fingerprint once it has played. */
  shoot(code?: ShotCode): Promise<string>;
  setView(mode: ViewMode, immediate?: boolean): void;
  view(): ViewMode;
  setPlaybackSpeed(speed: number): void;
  render(): void;
  cueBall(): { x: number; y: number };
  /** Where a point of the table (z above the cloth) appears in the window. */
  toClient(x: number, y: number, z?: number): { x: number; y: number };
  /** Whether the camera has come to rest. */
  cameraSettled(): boolean;
  /** The pockets' centres and the cue ball's, in client pixels. */
  landmarks(): { pockets: { x: number; y: number }[]; cueBall: { x: number; y: number } | null };
  match(): {
    mode: string;
    phase: string;
    turn: number;
    shot: number;
    rackNumber: number;
    score: readonly number[];
    winner: number | null;
    inHand: string | null;
    decision: string | null;
    groups: readonly number[];
  };
  aim(): { heading: number; power: number; a: number; b: number; elevation: number };
  /** Whether the aiming guide is drawn on the cloth. */
  guideShown(): boolean;
  /**
   * Sets up a rack in play for a test: the players' groups, whose turn it is, and which balls are
   * still on the table (the rest go to the first pocket).
   */
  arrange(options: { groups: [Group, Group]; turn: Seat; onTable: number[] }): void;
  /** The camera drawn with: where it is, which way is up on screen, and its zoom. */
  camera(): { x: number; y: number; z: number; upX: number; upZ: number; zoom: number };
}

declare global {
  interface Window {
    __poolDebug?: PoolDebug;
  }
}

export function installDebugHook(app: App, ui: UiRoot): void {
  window.__poolDebug = {
    hash: () => app.hash(),
    async shoot(code) {
      const result = await app.shoot(code);
      void ui.afterShot(result);
      return app.hash();
    },
    setView: (mode, immediate) => app.setView(mode, immediate),
    view: () => app.rig.view,
    setPlaybackSpeed(speed) {
      app.player.speed = speed;
    },
    render: () => app.scene.renderNow(),
    cueBall: () => {
      const c = app.match.current.balls[0]!;
      return { x: c.rx, y: c.ry };
    },
    toClient: (x, y, z) => app.toClient(x, y, z),
    cameraSettled: () => !app.rig.moving,
    landmarks: () => {
      const c = app.match.current.balls[0]!;
      return {
        pockets: app.match.table.pockets.map((p) => app.toClient(p.center.x, p.center.y)),
        cueBall: c.s === Motion.Pocketed ? null : app.toClient(c.rx, c.ry, c.rz),
      };
    },
    match: () => {
      const s = app.match.current;
      return {
        mode: s.setup.mode,
        phase: s.rack.phase,
        turn: s.rack.turn,
        shot: s.shot,
        rackNumber: s.rackNumber,
        score: s.score,
        winner: s.winner,
        inHand: app.match.inHand(),
        decision: s.rack.decision,
        groups: s.rack.groups,
      };
    },
    aim: () => ({ ...app.aim }),
    guideShown: () => app.guide.visible,
    arrange({ groups, turn, onTable }) {
      const s = app.match.current;
      const pocket = app.match.table.pockets[0]!.center;
      const balls = s.balls.map((b, n) =>
        n === 0 || onTable.includes(n)
          ? { ...b }
          : { ...b, rx: pocket.x, ry: pocket.y, s: Motion.Pocketed },
      );
      app.match.state.set({
        ...s,
        balls,
        rack: { ...s.rack, phase: 'play', groups, turn, inHand: 'none', decision: null },
      });
      app.calledPocket = null;
      app.showBalls();
    },
    camera: () => {
      const c = app.rig.camera;
      const size = 'isOrthographicCamera' in c ? c.top - c.bottom : 0;
      return {
        x: c.position.x,
        y: c.position.y,
        z: c.position.z,
        upX: c.up.x,
        upZ: c.up.z,
        zoom: size,
      };
    },
  };
}

export function removeDebugHook(): void {
  delete window.__poolDebug;
}
