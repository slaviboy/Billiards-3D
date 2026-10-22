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

// The billiards simulation: an event-based model translated from pooltool. See docs/physics.md.

export { simulate, type PhysicsEvent, type SimulateOptions, type Timeline } from './simulate.ts';
export { sampleInto, segmentAt } from './sample.ts';
export { stateHash } from './hash.ts';
export type { Strike } from './resolve/stick.ts';
export {
  ballState,
  copyState,
  Motion,
  MIN_DIST,
  POOL_BALL,
  POOL_CUE,
  type BallParams,
  type BallState,
  type CueParams,
} from './state.ts';
export type { CircularCushion, LinearCushion, PhysicsTable, Pocket, PocketId } from './types.ts';
