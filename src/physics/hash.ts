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

// A fingerprint of the table: 64-bit FNV-1a over the exact bits of every ball's position and
// motion state, and any further integers (the rules' state, the shot number). Online, both players
// compare it after every shot; equal fingerprints mean equal tables, to the last bit.

import type { BallState } from './state.ts';

const OFFSET = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const view = new DataView(new ArrayBuffer(8));

function mix(h: bigint, byte: number): bigint {
  return BigInt.asUintN(64, (h ^ BigInt(byte)) * PRIME);
}

function mixNumber(h: bigint, x: number): bigint {
  // −0 and +0 are the same position; JSON cannot tell them apart either.
  view.setFloat64(0, x + 0);
  for (let i = 0; i < 8; i++) h = mix(h, view.getUint8(i));
  return h;
}

/** 16 hexadecimal digits. */
export function stateHash(
  balls: readonly Readonly<BallState>[],
  extra: readonly number[] = [],
): string {
  let h = OFFSET;
  for (const b of balls) {
    h = mixNumber(h, b.rx);
    h = mixNumber(h, b.ry);
    h = mixNumber(h, b.s);
  }
  for (const x of extra) h = mixNumber(h, x);
  return h.toString(16).padStart(16, '0');
}
