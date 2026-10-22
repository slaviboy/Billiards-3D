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

// Playback follows the simulation, not the frame rate: the balls end in the same places at 30,
// 60 and 144 frames a second, and a rolling ball turns by its distance over its radius.

import { describe, expect, it } from 'vitest';
import { ballState, Motion, simulate } from '../../src/physics/index.ts';
import { ShotPlayer } from '../../src/scene/ShotPlayer.ts';
import type { BallSet } from '../../src/scene/BallSet.ts';
import { buildTable } from '../../src/table/geometry.ts';
import { rackBalls, seedFrom } from '../../src/table/rack.ts';
import { BALL_RADIUS as R, tableSpec } from '../../src/table/spec.ts';
import { decodeShot, encodeShot } from '../../src/game/shotCodec.ts';

/** Records what the player does to the balls. */
class FakeBalls {
  readonly at: [number, number, number][] = Array.from({ length: 16 }, () => [0, 0, 0]);
  readonly turned: number[] = new Array<number>(16).fill(0);
  place(n: number, x: number, y: number, z: number) {
    this.at[n] = [x, y, z];
  }
  setVisible() {}
  spin(n: number, wx: number, wy: number, wz: number, dt: number) {
    this.turned[n] = this.turned[n]! + Math.hypot(wx, wy, wz) * dt;
  }
}

const table = buildTable(tableSpec('9ft'));
const playerTable = { W: table.spec.W, L: table.spec.L, pockets: table.pockets };

function playAt(fps: number, timeline: ReturnType<typeof simulate>): FakeBalls {
  const balls = new FakeBalls();
  const player = new ShotPlayer(balls as unknown as BallSet, playerTable);
  void player.play(timeline);
  for (let i = 0; i < 100000 && player.update(1 / fps); i++);
  return balls;
}

describe('shot playback', () => {
  it('ends in the same places whatever the frame rate', () => {
    const balls = rackBalls(table, seedFrom('playback'));
    const timeline = simulate(
      balls,
      decodeShot(encodeShot(Math.PI / 2, 0, 6, 0, -0.1)),
      table.physics,
    );
    const runs = [30, 60, 144].map((fps) => playAt(fps, timeline));
    for (let n = 0; n < 16; n++) {
      if (timeline.final[n]!.s === Motion.Pocketed) continue;
      expect(runs[1]!.at[n]).toEqual(runs[0]!.at[n]);
      expect(runs[2]!.at[n]).toEqual(runs[0]!.at[n]);
    }
  });

  it('turns a rolling ball by its distance over its radius', () => {
    const v = 0.4; // rolls v²/(2·μr·g) ≈ 0.82 m: clear of the cushions
    const start = ballState(table.spec.W / 2, 0.5, R, Motion.Rolling);
    start.vy = v;
    start.wx = -v / R;
    const timeline = simulate([start], null, table.physics);
    const distance = timeline.final[0]!.ry - 0.5;
    const balls = playAt(60, timeline);
    expect(balls.turned[0]! / (distance / R)).toBeCloseTo(1, 3);
  });
});
