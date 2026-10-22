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

// Puts the game together: the scene, the cameras, the table, the balls, the cue and the aiming
// guide, the match being played, the shot being lined up, and the playing of shots. The balls' true
// positions are the match's; the meshes only follow.

import { Vector3 } from 'three';
import { hitFor } from '../audio/shotAudio.ts';
import { SoundManager } from '../audio/SoundManager.ts';
import { FrameMonitor } from '../core/FrameMonitor.ts';
import type { Store } from '../core/Store.ts';
import {
  MatchController,
  type MatchSetup,
  type MatchState,
  type ShotResult,
} from '../game/MatchController.ts';
import { encodePlacement, encodeShot, type Placement, type ShotCode } from '../game/shotCodec.ts';
import { Motion, type PhysicsEvent } from '../physics/index.ts';
import type { PocketId } from '../physics/types.ts';
import { legalTargets } from '../rules/eightBall.ts';
import type { Intent, Seat } from '../rules/types.ts';
import { toScene } from '../table/frame.ts';
import { BallSet } from '../scene/BallSet.ts';
import { AimGuide } from '../scene/AimGuide.ts';
import { CameraRig, type Insets, type ViewMode } from '../scene/CameraRig.ts';
import { CueView } from '../scene/CueView.ts';
import { InHandMarker } from '../scene/InHandMarker.ts';
import { PoolScene, type Quality } from '../scene/PoolScene.ts';
import { ShotPlayer } from '../scene/ShotPlayer.ts';
import { TableView } from '../scene/TableView.ts';
import { TableInput } from '../input/TableInput.ts';
import type { Settings } from './Settings.ts';

/** The shot being lined up. Heading in radians on the table; power 0–1; tip offset in units of R
 * (a to the shooter's left, b up); elevation in degrees. */
export interface Aim {
  heading: number;
  power: number;
  a: number;
  b: number;
  elevation: number;
}

/** Cue speed for a power setting: fine control at the soft end, a full break at the top. */
export function cueSpeed(power: number): number {
  const p = Math.max(0, Math.min(1, power));
  return 0.25 + 7.25 * p * p;
}

export class App {
  readonly scene: PoolScene;
  readonly rig: CameraRig;
  readonly tableView: TableView;
  readonly balls = new BallSet();
  readonly cue: CueView;
  readonly guide = new AimGuide();
  readonly inHandMarker = new InHandMarker();
  readonly player: ShotPlayer;
  readonly match: MatchController;
  readonly input: TableInput;
  readonly sound = new SoundManager();
  readonly ready: Promise<void>;
  aim: Aim = { heading: Math.PI / 2, power: 0.45, a: 0, b: 0, elevation: 3 };
  calledPocket: PocketId | null = null;
  safety = false;
  /** Seats played on this device: both on one device, one online. */
  localSeats: readonly Seat[] = [0, 1];
  /** Called when the graphics were lowered because frames ran slow, with the frame rate seen. */
  onQualityLowered: (fps: number) => void = () => {};
  /** Called as the shot's playback passes each event (sounds). */
  onEvent: (event: PhysicsEvent) => void = () => {};
  private busy = false;
  private pull = 0;
  /** Frame times while something moves, to spot a device too slow for the high quality. */
  private readonly frames = new FrameMonitor();
  /** The cue's speed in the shot playing (m/s), for the sound of the tip. */
  private strikeSpeed = 0;
  private readonly ballCentre = new Vector3();
  private readonly projected = new Vector3();
  private readonly out = { x: 0, y: 0, z: 0 };
  private shownSize: string | null = null;

  constructor(
    root: HTMLElement,
    baseUrl: string,
    readonly settings: Store<Settings>,
    quality: Quality,
  ) {
    const s = settings.get();
    this.rig = new CameraRig(() => this.scene?.requestRender());
    this.scene = new PoolScene(root, this.rig.camera, quality);
    this.tableView = new TableView(baseUrl);
    this.cue = new CueView(baseUrl);
    this.scene.scene.add(
      this.tableView.group,
      this.balls.group,
      this.cue.group,
      this.guide.group,
      this.inHandMarker.group,
    );
    this.match = new MatchController({
      mode: 'practice',
      size: s.table,
      race: 1,
      shotClock: 0,
      names: [s.name, s.name2],
      seed: 'welcome',
      firstBreak: 0,
    });
    this.player = new ShotPlayer(this.balls, this.playerTable(), (e, ago) => {
      const hit = hitFor(e, this.strikeSpeed);
      if (hit) this.sound.hit(hit, ago);
      this.onEvent(e);
    });
    this.scene.onResize((w, h) => {
      this.rig.setSize(w, h);
      this.guide.setResolution(w, h);
    });
    this.scene.addUpdater((dt) => {
      const moving = this.rig.update(dt);
      this.scene.camera = this.rig.camera;
      const playing = this.player.update(dt);
      this.sound.setRolling(this.player.rollingSpeed);
      this.watchFrames(dt, moving || playing);
      return moving || playing;
    });
    this.input = new TableInput(this.scene.renderer.domElement, {
      canAct: () => this.canAct(),
      cueBall: () => {
        const c = this.match.current.balls[0]!;
        return c.s === Motion.Pocketed ? null : { x: c.rx, y: c.ry };
      },
      inHand: () => this.match.inHand() !== null,
      aimAt: (x, y) => {
        const c = this.match.current.balls[0]!;
        if (Math.hypot(x - c.rx, y - c.ry) < 1e-4) return;
        this.aim.heading = Math.atan2(y - c.ry, x - c.rx);
        this.refresh();
      },
      turnAim: (angle) => {
        this.aim.heading += angle;
        this.refresh();
      },
      moveCueBall: (x, y) => {
        const ok = this.match.placeCueBall(x, y);
        if (ok) this.showBalls();
        return ok;
      },
      placed: () => this.refresh(),
      orbit: (da, de) => this.rig.orbit(da, de),
      zoom: (f) => this.rig.zoom(f),
      pan: (dx, dz) => this.rig.panBy(dx, dz),
      tilts: () => this.rig.view === '3d',
      table: () => this.match.table.spec,
      camera: () => this.rig.camera,
    });
    settings.subscribe((next) => {
      if (next.view !== this.rig.view) this.rig.setView(next.view);
      this.rig.setKeepZoom(next.keepZoom);
      this.sound.configure(next.sound, next.volume);
      this.guide.setLength(next.guide);
      this.player.speed = next.speed;
      this.tableView.setCloth(next.cloth);
      this.refresh();
    });
    this.rig.setView(s.view, true);
    this.ready = this.showMatch().then(() => this.cue.ready);
  }

  private playerTable() {
    const t = this.match.table;
    return { W: t.spec.W, L: t.spec.L, pockets: t.pockets };
  }

  /**
   * On the automatic setting, a device that animates at under 40 frames a second is given the low
   * quality, once, and told why.
   */
  private watchFrames(dt: number, animating: boolean): void {
    if (this.settings.get().quality !== 'auto' || this.scene.quality === 'low') return;
    this.frames.record(dt, animating);
    if (!this.frames.slow) return;
    const fps = Math.round(1 / this.frames.median);
    this.frames.reset();
    this.scene.lowerQuality();
    this.onQualityLowered(fps);
  }

  /** Starts a match with these terms. */
  async newMatch(setup: MatchSetup, localSeats: readonly Seat[] = [0, 1]): Promise<void> {
    this.player.finish();
    this.localSeats = localSeats;
    this.match.start(setup);
    await this.showMatch();
  }

  /** Shows the match's table and balls as they are now. */
  async showMatch(): Promise<void> {
    const t = this.match.table;
    this.player.setTable(this.playerTable());
    if (this.shownSize !== t.spec.size) {
      this.rig.setTable(t.spec.W / 2 + t.spec.railWidth, t.spec.L / 2 + t.spec.railWidth);
      await this.tableView.show(t.spec.size);
      this.shownSize = t.spec.size;
    }
    this.balls.scramble(this.match.current.rackNumber * 7919 + 17);
    this.showBalls();
    this.aimAtRack();
    this.refresh();
  }

  /** Aims the cue ball at the rack (or the table's middle). */
  aimAtRack(): void {
    const c = this.match.current.balls[0]!;
    const target =
      this.match.current.rack.phase === 'break'
        ? this.match.table.footSpot
        : this.match.table.centerSpot;
    if (Math.hypot(target.x - c.rx, target.y - c.ry) > 0.01) {
      this.aim.heading = Math.atan2(target.y - c.ry, target.x - c.rx);
    }
  }

  showBalls(): void {
    this.player.show(this.match.current.balls);
    this.refresh();
  }

  setView(mode: ViewMode, immediate = false): void {
    this.rig.setView(mode, immediate);
    this.settings.update({ view: mode });
  }

  setInsets(insets: Insets): void {
    this.rig.setInsets(insets);
  }

  /** Whether the player at this device may aim, place and shoot now. */
  canAct(state: MatchState = this.match.current): boolean {
    return (
      !this.busy &&
      state.winner === null &&
      (state.rack.phase === 'break' || state.rack.phase === 'play') &&
      this.localSeats.includes(state.rack.turn)
    );
  }

  get playing(): boolean {
    return this.busy;
  }

  /** The integer code of the current aim, as it would be sent. */
  get shotCode(): ShotCode {
    return encodeShot(
      this.aim.heading,
      this.aim.elevation,
      cueSpeed(this.aim.power),
      this.aim.a,
      this.aim.b,
    );
  }

  get intent(): Intent {
    return { pocket: this.match.needsCall() ? this.calledPocket : null, safety: this.safety };
  }

  /** Whether everything a shot needs is set (the 8's pocket called when it must be). */
  get readyToShoot(): boolean {
    return this.canAct() && (!this.match.needsCall() || this.calledPocket !== null);
  }

  /** Pulls the cue back by a fraction of its stroke (while the power is being set). */
  setPull(pull: number): void {
    this.pull = pull;
    this.updateCue();
  }

  /**
   * Plays a shot: this device's aim, or (online) the other player's shot. Resolves with the result
   * once it has played.
   */
  async shoot(
    code: ShotCode = this.shotCode,
    intent: Intent = this.intent,
    placement?: Placement | null,
  ): Promise<ShotResult> {
    if (this.busy) throw new Error('a shot is already playing');
    const inHand = this.match.inHand();
    const cue = this.match.current.balls[0]!;
    const place =
      placement !== undefined ? placement : inHand ? encodePlacement(cue.rx, cue.ry) : null;
    this.busy = true;
    try {
      const result = this.match.shoot(code, intent, place);
      this.strikeSpeed = code.speed / 1000;
      this.cue.visible = false;
      this.guide.visible = false;
      this.pull = 0;
      this.calledPocket = null;
      this.safety = false;
      await this.player.play(result.timeline);
      this.busy = false;
      this.showBalls();
      if (this.match.current.rack.phase === 'break') this.aimAtRack();
      this.refresh();
      return result;
    } finally {
      this.busy = false;
    }
  }

  /** Where a point of the table (its frame; z above the cloth) appears, in client pixels. */
  toClient(x: number, y: number, z = 0): { x: number; y: number; visible: boolean } {
    const { W, L } = this.match.table.spec;
    toScene(x, y, z, W, L, this.out);
    this.projected.set(this.out.x, this.out.y, this.out.z).project(this.rig.camera);
    const rect = this.scene.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((this.projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - this.projected.y) / 2) * rect.height,
      visible: this.projected.z > -1 && this.projected.z < 1,
    };
  }

  /** The table's fingerprint (the same on both players' computers). */
  hash(): string {
    return this.match.hash();
  }

  /** Brings the cue, the guide and the balls in line with the match and the aim. */
  refresh(): void {
    this.updateCue();
    this.updateGuide();
    this.updateInHand();
    this.scene.requestRender();
  }

  /** The ring round a cue ball in hand, and the head string while it must stay behind it. */
  private updateInHand(): void {
    const where = this.match.inHand();
    const cue = this.match.current.balls[0]!;
    if (!where || !this.canAct() || cue.s === Motion.Pocketed) {
      this.inHandMarker.hide();
      return;
    }
    const { W, L } = this.match.table.spec;
    toScene(cue.rx, cue.ry, 0, W, L, this.out);
    const line = where === 'kitchen' ? { z: L / 2 - this.match.table.headString, width: W } : null;
    this.inHandMarker.show(this.out.x, this.out.z, line);
  }

  private updateGuide(): void {
    const state = this.match.current;
    const cue = state.balls[0]!;
    const show = this.canAct() && cue.s !== Motion.Pocketed && this.settings.get().guide !== 'off';
    this.guide.visible = show;
    if (!show) return;
    const { W, L } = this.match.table.spec;
    const p = this.guide.update(
      state.balls,
      this.match.table.physics,
      Math.cos(this.aim.heading),
      Math.sin(this.aim.heading),
      (x, y) => ({ x: x - W / 2, z: L / 2 - y }),
    );
    const targets = legalTargets(state.rack, this.match.onTable(state));
    this.guide.setLegal(
      p.ball === null || state.setup.mode === 'practice' || targets.includes(p.ball),
    );
  }

  updateCue(): void {
    const cueBall = this.match.current.balls[0]!;
    if (cueBall.s === Motion.Pocketed || this.busy || !this.canAct()) {
      this.cue.visible = false;
      this.scene.requestRender();
      return;
    }
    const { W, L } = this.match.table.spec;
    toScene(cueBall.rx, cueBall.ry, cueBall.rz, W, L, this.out);
    this.ballCentre.set(this.out.x, this.out.y, this.out.z);
    this.cue.pose({
      ball: this.ballCentre,
      dirX: Math.cos(this.aim.heading),
      dirZ: -Math.sin(this.aim.heading),
      elevation: (this.aim.elevation * Math.PI) / 180,
      a: this.aim.a,
      b: this.aim.b,
      gap: 0.012 + this.pull * 0.22,
    });
    this.cue.visible = true;
    this.scene.requestRender();
  }
}
