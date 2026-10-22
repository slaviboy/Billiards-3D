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

// What a shot sounds like, worked out from the simulation's events: which sound each contact makes
// and how loud, from the speed of the impact; and a mixer that keeps a break from turning into
// noise, folding contacts that land together into one sound and capping how many play at once.

import type { PhysicsEvent } from '../physics/index.ts';

export type Voice = 'cue' | 'ball' | 'cushion' | 'jaw' | 'pocket';

export interface Hit {
  readonly voice: Voice;
  /** 0–1. */
  readonly level: number;
}

/** The impact speed (m/s) at which each sound is at its loudest. */
const FULL: Record<Voice, number> = { cue: 7, ball: 6, cushion: 4, jaw: 3.5, pocket: 3 };
/** Contacts slower than this (m/s) are not heard: balls nudging, resting against a cushion. */
export const SILENT_BELOW = 0.015;
/** The ear hears impacts roughly logarithmically; this sets where the curve bends (m/s). */
const KNEE = 0.06;

/** How loud a contact of this kind and speed sounds, 0–1; never quieter for a harder hit. */
export function loudness(voice: Voice, speed: number): number {
  if (!(speed > SILENT_BELOW)) return 0;
  return Math.min(1, Math.log1p(speed / KNEE) / Math.log1p(FULL[voice] / KNEE));
}

/** The sound an event makes, or null for one that makes none (or too soft to hear). */
export function hitFor(event: PhysicsEvent, cueSpeed: number): Hit | null {
  let voice: Voice;
  let speed: number;
  switch (event.kind) {
    case 'stick':
      [voice, speed] = ['cue', cueSpeed];
      break;
    case 'ball':
      [voice, speed] = ['ball', event.impact];
      break;
    case 'cushion':
      [voice, speed] = ['cushion', event.impact];
      break;
    case 'jaw':
      [voice, speed] = ['jaw', event.impact];
      break;
    case 'pocket':
      [voice, speed] = ['pocket', Math.hypot(event.entry.vx, event.entry.vy)];
      break;
    default:
      return null;
  }
  const level = loudness(voice, speed);
  return level > 0 ? { voice, level } : null;
}

/** How long each sound rings, seconds (for counting the voices sounding). */
export const DURATION: Record<Voice, number> = {
  cue: 0.2,
  ball: 0.18,
  cushion: 0.26,
  jaw: 0.21,
  pocket: 0.75,
};
/** Contacts of one kind closer together than this are heard as one, seconds. */
export const MERGE_WINDOW = 0.012;
/** At most this many sounds at once. */
export const MAX_VOICES = 14;

/**
 * Decides which contacts are played. Each is offered with the time it would start; it is played,
 * or dropped because a sound of its kind at least as loud starts within the merge window, or
 * because as many sounds as allowed are ringing.
 */
export class HitMixer {
  private sounding: { voice: Voice; at: number; end: number; level: number }[] = [];

  /** Whether to play this hit, starting at `at` (seconds on any steady clock). */
  accept(hit: Hit, at: number): boolean {
    this.sounding = this.sounding.filter((s) => s.end > at);
    const twin = this.sounding.find(
      (s) => s.voice === hit.voice && Math.abs(s.at - at) < MERGE_WINDOW,
    );
    if (twin && twin.level >= hit.level) return false;
    if (this.sounding.length >= MAX_VOICES) return false;
    this.sounding.push({ voice: hit.voice, at, end: at + DURATION[hit.voice], level: hit.level });
    return true;
  }

  /** How many sounds ring at this moment. */
  ringing(at: number): number {
    return this.sounding.filter((s) => s.at <= at && s.end > at).length;
  }

  reset(): void {
    this.sounding = [];
  }
}
