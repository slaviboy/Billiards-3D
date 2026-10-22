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

// What a shot did, read from the simulation's events: the facts the rules judge. Nothing is
// guessed from where the balls ended up.

import { trajectory } from '../physics/motion.ts';
import type { Timeline } from '../physics/simulate.ts';
import { type BallParams, type BallState, POOL_BALL } from '../physics/state.ts';
import type { PocketId } from '../physics/types.ts';

export interface ShotFacts {
  /** The first object ball the cue ball touched, or null. */
  readonly firstContact: number | null;
  readonly firstContactTime: number;
  /** After that contact, some ball reached a cushion or a pocket (WPA 2.7, 3.3). */
  readonly railAfterContact: boolean;
  /** Balls pocketed, in order (0 is the cue ball). */
  readonly pocketed: readonly { readonly ball: number; readonly pocket: PocketId }[];
  readonly scratch: boolean;
  /** Object balls driven to a rail or pocketed during the shot (the break's four). */
  readonly ballsToRail: number;
  /** The cue ball's centre reached the head string before its first contact (WPA 3.11). */
  readonly crossedHeadString: boolean;
  /** The first ball touched lay on or below the head string. */
  readonly firstContactBelowHeadString: boolean;
}

export function shotFacts(
  timeline: Timeline,
  start: readonly Readonly<BallState>[],
  headString: number,
  params: BallParams = POOL_BALL,
): ShotFacts {
  let firstContact: number | null = null;
  let firstContactTime = Infinity;
  for (const e of timeline.events) {
    if (e.kind === 'ball' && (e.a === 0 || e.b === 0)) {
      firstContact = e.a === 0 ? e.b : e.a;
      firstContactTime = e.t;
      break;
    }
  }
  let railAfterContact = false;
  const pocketed: { ball: number; pocket: PocketId }[] = [];
  const toRail = new Set<number>();
  for (const e of timeline.events) {
    if (e.kind === 'cushion' || e.kind === 'jaw') {
      if (e.t > firstContactTime) railAfterContact = true;
      if (e.ball !== 0) toRail.add(e.ball);
    } else if (e.kind === 'pocket') {
      pocketed.push({ ball: e.ball, pocket: e.pocket });
      if (e.t > firstContactTime) railAfterContact = true;
      if (e.ball !== 0) toRail.add(e.ball);
    }
  }
  const first = firstContact === null ? null : start[firstContact];
  return {
    firstContact,
    firstContactTime,
    railAfterContact,
    pocketed,
    scratch: pocketed.some((p) => p.ball === 0),
    ballsToRail: toRail.size,
    crossedHeadString: reaches(timeline, 0, headString, firstContactTime, params),
    firstContactBelowHeadString: first ? first.ry >= headString : false,
  };
}

const path = new Float64Array(6);

/** Whether ball `index`'s centre reaches y ≥ line at some moment before `until`. */
function reaches(
  timeline: Timeline,
  index: number,
  line: number,
  until: number,
  params: BallParams,
): boolean {
  const segments = timeline.segments[index]!;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    if (segment.t >= until) break;
    if (segment.ry >= line) return true;
    const end = Math.min(until, i + 1 < segments.length ? segments[i + 1]!.t : timeline.duration);
    trajectory(segment, params, path);
    // y(τ) = c + b·τ + a·τ² over [0, end − start]: its highest point is an end or the vertex.
    const a = path[1]!;
    const b = path[3]!;
    const c = path[5]!;
    const span = end - segment.t;
    const yEnd = c + (b + a * span) * span;
    if (yEnd >= line) return true;
    if (a < 0) {
      const vertex = -b / (2 * a);
      if (vertex > 0 && vertex < span && c + (b + a * vertex) * vertex >= line) return true;
    }
  }
  return false;
}
