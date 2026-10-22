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

// A simulated shot at any moment: where each ball is, how it moves and spins. The renderer asks
// for whatever time its frame shows; the answer comes from the closed-form path of the segment in
// force, so it does not depend on the frame rate.

import { evolve } from './motion.ts';
import type { Timeline } from './simulate.ts';
import { type BallParams, type BallState, POOL_BALL } from './state.ts';

/** The segment of `ball` in force at time t (the last that starts at or before t). */
export function segmentAt(timeline: Timeline, ball: number, t: number): Readonly<BallState> {
  const list = timeline.segments[ball]!;
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid]!.t <= t) lo = mid;
    else hi = mid - 1;
  }
  return list[lo]!;
}

/** The state of `ball` at time t, written into `out`. */
export function sampleInto(
  timeline: Timeline,
  ball: number,
  t: number,
  out: BallState,
  params: BallParams = POOL_BALL,
): BallState {
  const segment = segmentAt(timeline, ball, t);
  const dt = Math.max(0, Math.min(t, timeline.duration) - segment.t);
  evolve(segment, dt, params, out);
  out.t = segment.t + dt;
  return out;
}
