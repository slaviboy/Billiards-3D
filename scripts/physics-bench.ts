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

// Times the simulation of full breaks, the heaviest shots there are.
// Usage: node scripts/physics-bench.ts [count]

import { ballState, simulate, type BallState } from '../src/physics/index.ts';
import { buildTable } from '../src/table/geometry.ts';
import { tableSpec } from '../src/table/spec.ts';

const count = Number(process.argv[2] ?? 50);
const table = buildTable(tableSpec('9ft')).physics;
const R = 0.028575;
const { W, L } = table;

let seed = 1;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

function rack(): BallState[] {
  const balls = [ballState(W / 2 + (random() - 0.5) * 0.3, L / 4, R)];
  const spacing = 2 * R * (1 + 1e-3);
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k <= row; k++) {
      balls.push(
        ballState(
          W / 2 + (k - row / 2) * spacing + (random() - 0.5) * 2e-5,
          (3 * L) / 4 + row * spacing * (Math.sqrt(3) / 2) + (random() - 0.5) * 2e-5,
          R,
        ),
      );
    }
  }
  return balls;
}

const times: number[] = [];
let events = 0;
let maxEvents = 0;
for (let i = 0; i < count; i++) {
  const balls = rack();
  const dx = W / 2 - balls[0]!.rx;
  const dy = (3 * L) / 4 - balls[0]!.ry;
  const d = Math.hypot(dx, dy);
  const start = performance.now();
  const timeline = simulate(
    balls,
    {
      ball: 0,
      V0: 6 + random() * 3,
      cosPhi: dx / d,
      sinPhi: dy / d,
      cosTheta: 1,
      sinTheta: 0,
      a: (random() - 0.5) * 0.2,
      b: (random() - 0.5) * 0.4,
    },
    table,
  );
  times.push(performance.now() - start);
  events += timeline.events.length;
  maxEvents = Math.max(maxEvents, timeline.events.length);
}
times.sort((a, b) => a - b);
const mean = times.reduce((a, b) => a + b, 0) / times.length;
console.log(
  `${count} breaks: mean ${mean.toFixed(1)} ms, median ${times[times.length >> 1]!.toFixed(1)} ms, ` +
    `max ${times[times.length - 1]!.toFixed(1)} ms; events mean ${(events / count).toFixed(0)}, max ${maxEvents}`,
);
