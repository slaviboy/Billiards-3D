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

// Puts the game together: the scene, the cameras, the table, the balls, the cue, and the playing
// of shots. The balls' true positions live here, as the simulation leaves them; the meshes only
// follow.

import { Vector3 } from 'three';
import { decodeShot, encodeShot, type ShotCode } from '../game/shotCodec.ts';
import { Motion, simulate, stateHash, type BallState, type Timeline } from '../physics/index.ts';
import { toScene } from '../table/frame.ts';
import { buildTable, type TableGeometry } from '../table/geometry.ts';
import { rackBalls, seedFrom } from '../table/rack.ts';
import { tableSpec, type TableSize } from '../table/spec.ts';
import { BallSet } from '../scene/BallSet.ts';
import { CameraRig, type Insets, type ViewMode } from '../scene/CameraRig.ts';
import { CueView } from '../scene/CueView.ts';
import { PoolScene, type Quality } from '../scene/PoolScene.ts';
import { ShotPlayer } from '../scene/ShotPlayer.ts';
import { TableView } from '../scene/TableView.ts';

/** The shot being lined up: aim heading (radians, table frame), cue speed, tip offset, elevation. */
export interface Aim {
  heading: number;
  speed: number;
  a: number;
  b: number;
  elevation: number;
}

export class App {
  readonly scene: PoolScene;
  readonly rig: CameraRig;
  readonly tableView: TableView;
  readonly balls = new BallSet();
  readonly cue: CueView;
  readonly player: ShotPlayer;
  readonly ready: Promise<void>;
  table: TableGeometry;
  /** Where the balls are, as the simulation left them. */
  state: BallState[];
  aim: Aim = { heading: Math.PI / 2, speed: 3, a: 0, b: 0, elevation: 3 };
  private readonly ballCentre = new Vector3();
  private readonly out = { x: 0, y: 0, z: 0 };

  constructor(
    root: HTMLElement,
    private readonly baseUrl: string,
    size: TableSize,
    quality: Quality,
  ) {
    this.rig = new CameraRig(() => this.scene?.requestRender());
    this.scene = new PoolScene(root, this.rig.camera, quality);
    this.tableView = new TableView(baseUrl);
    this.cue = new CueView(baseUrl);
    this.scene.scene.add(this.tableView.group, this.balls.group, this.cue.group);
    this.table = buildTable(tableSpec(size));
    this.state = rackBalls(this.table, seedFrom('practice'));
    this.player = new ShotPlayer(this.balls, this.playerTable());
    this.scene.onResize((w, h) => this.rig.setSize(w, h));
    this.scene.addUpdater((dt) => {
      const moving = this.rig.update(dt);
      this.scene.camera = this.rig.camera;
      const playing = this.player.update(dt);
      return moving || playing;
    });
    this.ready = this.setTable(size).then(() => this.cue.ready);
  }

  private playerTable() {
    return { W: this.table.spec.W, L: this.table.spec.L, pockets: this.table.pockets };
  }

  /** Changes the table (and racks the balls on it). */
  async setTable(size: TableSize): Promise<void> {
    this.table = buildTable(tableSpec(size));
    this.player.setTable(this.playerTable());
    const { W, L, railWidth } = this.table.spec;
    this.rig.setTable(W / 2 + railWidth, L / 2 + railWidth);
    await this.tableView.show(size);
    this.rack('practice');
  }

  rack(seed: string): void {
    this.state = rackBalls(this.table, seedFrom(seed));
    this.balls.scramble(seedFrom(seed));
    this.player.show(this.state);
    this.aim.heading = Math.atan2(
      this.table.footSpot.y - this.state[0]!.ry,
      this.table.footSpot.x - this.state[0]!.rx,
    );
    this.updateCue();
  }

  setView(mode: ViewMode, immediate = false): void {
    this.rig.setView(mode, immediate);
  }

  setInsets(insets: Insets): void {
    this.rig.setInsets(insets);
  }

  /** The integer code of the current aim, as it would be sent. */
  get shotCode(): ShotCode {
    return encodeShot(this.aim.heading, this.aim.elevation, this.aim.speed, this.aim.a, this.aim.b);
  }

  /** Plays a shot from the balls' current positions; resolves when it has stopped. */
  async shoot(code: ShotCode = this.shotCode): Promise<Timeline> {
    if (this.player.playing) this.player.finish();
    const timeline = simulate(this.state, decodeShot(code), this.table.physics);
    this.cue.visible = false;
    this.state = timeline.final.map((b) => ({ ...b }));
    await this.player.play(timeline);
    this.updateCue();
    return timeline;
  }

  /** The table's fingerprint (the same on both players' computers). */
  hash(): string {
    return stateHash(this.state);
  }

  /** Lines the cue up behind the cue ball for the current aim. */
  updateCue(pull = 0): void {
    const cueBall = this.state[0]!;
    if (cueBall.s === Motion.Pocketed || this.player.playing) {
      this.cue.visible = false;
      this.scene.requestRender();
      return;
    }
    toScene(cueBall.rx, cueBall.ry, cueBall.rz, this.table.spec.W, this.table.spec.L, this.out);
    this.ballCentre.set(this.out.x, this.out.y, this.out.z);
    // Table heading to the scene: x stays, y becomes −z.
    this.cue.pose({
      ball: this.ballCentre,
      dirX: Math.cos(this.aim.heading),
      dirZ: -Math.sin(this.aim.heading),
      elevation: (this.aim.elevation * Math.PI) / 180,
      a: this.aim.a,
      b: this.aim.b,
      gap: 0.012 + pull,
    });
    this.cue.visible = true;
    this.scene.requestRender();
  }
}
