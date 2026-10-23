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

// Plays a simulated shot on screen. The shot is already decided (the timeline holds every ball's
// path in closed form), so each frame just asks where every ball is at the frame's moment of the
// shot: the result does not depend on the frame rate, only the smoothness does. Spin turns the
// balls (integrated in small fixed steps; visual only), and a pocketed ball drops into the pocket's
// net and comes to rest there with the others.

import type { PocketShape } from '../table/geometry.ts';
import { directionToScene, toScene } from '../table/frame.ts';
import { BALL_RADIUS } from '../table/spec.ts';
import {
  ballState,
  Motion,
  POOL_BALL,
  sampleInto,
  type BallState,
  type PhysicsEvent,
  type Timeline,
} from '../physics/index.ts';
import type { BallSet } from './BallSet.ts';

const R = BALL_RADIUS;
/** Where pocketed balls rest: the pocket net's floor (NET_FLOOR in blender/scripts/table.py). */
export const NET_FLOOR = -0.045 - 0.115 + 0.004;
const GRAVITY = 9.81;
/** The step spin is integrated in, seconds of shot time. */
const SPIN_STEP = 1 / 240;

interface Drop {
  readonly t: number;
  readonly pocket: number;
  readonly entry: Readonly<BallState>;
  /** Where it comes to rest in the net (scene coordinates). */
  readonly rest: { x: number; y: number; z: number };
}

export interface PlayerTable {
  readonly W: number;
  readonly L: number;
  readonly pockets: readonly PocketShape[];
}

export class ShotPlayer {
  /** Playback speed: 1 is real time. */
  speed = 1;
  private timeline: Timeline | null = null;
  private t = 0;
  private done: (() => void) | null = null;
  private drops = new Map<number, Drop>();
  private nextEvent = 0;
  private readonly sample = ballState(0, 0, 0);
  private readonly out = { x: 0, y: 0, z: 0 };
  private readonly spin = { x: 0, y: 0, z: 0 };
  /** Balls already resting in each pocket (for stacking the next one). */
  private pocketCounts = [0, 0, 0, 0, 0, 0];
  /** The balls' speeds on the cloth added up at the moment shown, m/s (for the rolling sound). */
  rollingSpeed = 0;

  constructor(
    private readonly balls: BallSet,
    private table: PlayerTable,
    /**
     * Called as playback passes each event, for sounds and effects, with how long before the
     * moment now shown it happened (seconds of real time).
     */
    private readonly onEvent: (event: PhysicsEvent, ago: number) => void = () => {},
  ) {}

  setTable(table: PlayerTable): void {
    this.table = table;
  }

  get playing(): boolean {
    return this.timeline !== null;
  }

  /** Puts the balls where these states say, at once (a rack, a restored game, a spotted ball). */
  show(states: readonly Readonly<BallState>[]): void {
    this.pocketCounts = [0, 0, 0, 0, 0, 0];
    states.forEach((s, n) => {
      if (s.s === Motion.Pocketed) {
        // A pocketed ball's state lies at its pocket's centre: rest it in that pocket's net.
        let pocket = 0;
        let best = Infinity;
        this.table.pockets.forEach((p, i) => {
          const d = Math.hypot(p.center.x - s.rx, p.center.y - s.ry);
          if (d < best) [best, pocket] = [d, i];
        });
        const rest = this.restIn(pocket);
        this.balls.setVisible(n, true);
        this.balls.place(n, rest.x, rest.y, rest.z);
        return;
      }
      this.balls.setVisible(n, true);
      toScene(s.rx, s.ry, s.rz, this.table.W, this.table.L, this.out);
      this.balls.place(n, this.out.x, this.out.y, this.out.z);
    });
  }

  /** Plays a timeline; resolves when it has finished (or been finished early). */
  play(timeline: Timeline): Promise<void> {
    this.finish();
    this.timeline = timeline;
    this.t = 0;
    this.nextEvent = 0;
    this.drops = new Map();
    for (const e of timeline.events) {
      if (e.kind !== 'pocket') continue;
      this.drops.set(e.ball, {
        t: e.t,
        pocket: e.pocket,
        entry: e.entry,
        rest: this.restIn(e.pocket),
      });
    }
    return new Promise((resolve) => (this.done = resolve));
  }

  /** Jumps to the end of the shot being played. */
  finish(): void {
    if (!this.timeline) return;
    this.advance(this.timeline.duration + 1, false);
  }

  /** Advances playback by dt seconds of real time; true while there is more to play. */
  update(dt: number): boolean {
    if (!this.timeline) return false;
    this.advance(this.t + dt * this.speed, true);
    return this.timeline !== null;
  }

  private advance(to: number, animate: boolean): void {
    const timeline = this.timeline!;
    const end = timeline.duration;
    const from = this.t;
    const target = Math.min(to, end + 1);
    // Spin, in fixed steps, while the shot's motion lasts.
    if (animate) {
      for (let a = from; a < Math.min(target, end); a += SPIN_STEP) {
        const b = Math.min(a + SPIN_STEP, target, end);
        const mid = (a + b) / 2;
        for (let n = 0; n < timeline.segments.length; n++) {
          sampleInto(timeline, n, mid, this.sample, POOL_BALL);
          if (this.sample.s === Motion.Pocketed || this.sample.s === Motion.Stationary) continue;
          directionToScene(this.sample.wx, this.sample.wy, this.sample.wz, this.spin);
          this.balls.spin(n, this.spin.x, this.spin.y, this.spin.z, b - a);
        }
      }
    }
    this.t = target;
    while (
      this.nextEvent < timeline.events.length &&
      timeline.events[this.nextEvent]!.t <= target
    ) {
      const event = timeline.events[this.nextEvent++]!;
      if (animate) this.onEvent(event, (target - event.t) / this.speed);
    }
    let dropping = false;
    let rolling = 0;
    for (let n = 0; n < timeline.segments.length; n++) {
      const drop = this.drops.get(n);
      if (drop && target >= drop.t) {
        dropping = this.placeDropping(n, drop, target - drop.t) || dropping;
        continue;
      }
      sampleInto(timeline, n, Math.min(target, end), this.sample, POOL_BALL);
      if (this.sample.s === Motion.Pocketed) continue;
      rolling += Math.hypot(this.sample.vx, this.sample.vy);
      this.balls.setVisible(n, true);
      toScene(this.sample.rx, this.sample.ry, this.sample.rz, this.table.W, this.table.L, this.out);
      this.balls.place(n, this.out.x, this.out.y, this.out.z);
    }
    this.rollingSpeed = animate && target < end ? rolling : 0;
    if (target >= end && !dropping) {
      this.timeline = null;
      const done = this.done;
      this.done = null;
      done?.();
    }
  }

  /**
   * A pocketed ball, `since` seconds after its centre crossed the pocket's edge: it runs on a
   * little, falls into the net and settles. Returns whether it is still moving.
   */
  private placeDropping(n: number, drop: Drop, since: number): boolean {
    const { entry, rest } = drop;
    toScene(entry.rx, entry.ry, R, this.table.W, this.table.L, this.out);
    const start = { ...this.out };
    directionToScene(entry.vx, entry.vy, 0, this.spin);
    const fall = Math.sqrt((2 * (R - rest.y)) / GRAVITY);
    const t = Math.min(since, fall);
    const k = t / fall;
    // Run on, slowed by the leather, and home toward the resting place as it falls.
    const runX = start.x + this.spin.x * t * 0.6;
    const runZ = start.z + this.spin.z * t * 0.6;
    const x = runX + (rest.x - runX) * k * k;
    const z = runZ + (rest.z - runZ) * k * k;
    const y = R - 0.5 * GRAVITY * t * t;
    this.balls.setVisible(n, true);
    this.balls.place(n, x, Math.max(y, rest.y), z);
    return since < fall;
  }

  /** The next free resting place in a pocket's net. */
  private restIn(pocket: number): { x: number; y: number; z: number } {
    const shape = this.table.pockets[pocket]!;
    toScene(shape.center.x, shape.center.y, 0, this.table.W, this.table.L, this.out);
    const k = this.pocketCounts[pocket]!++;
    // Three in the net's bottom, then the next layer on top of them.
    const layer = Math.floor(k / 3);
    const angle = (k % 3) * ((2 * Math.PI) / 3) + layer * 0.9;
    const spread = 1.15 * R;
    return {
      x: this.out.x + Math.cos(angle) * spread,
      y: NET_FLOOR + R + layer * R * 1.6,
      z: this.out.z + Math.sin(angle) * spread,
    };
  }
}
