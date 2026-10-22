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

// The sounds of a shot: which contacts make which sound, louder for harder impacts; contacts that
// land together fold into one and only so many ring at once; and the synthesiser schedules them
// at their own times within a frame, silent when sound is off. The synthesiser runs against a fake
// AudioContext that records what it is asked to do.

import { describe, expect, it } from 'vitest';
import {
  DURATION,
  HitMixer,
  MAX_VOICES,
  MERGE_WINDOW,
  SILENT_BELOW,
  hitFor,
  loudness,
  type Voice,
} from '../../../src/audio/shotAudio.ts';
import { SoundManager } from '../../../src/audio/SoundManager.ts';
import { ballState, Motion } from '../../../src/physics/index.ts';

const VOICES: Voice[] = ['cue', 'ball', 'cushion', 'jaw', 'pocket'];

describe('the sound of a contact', () => {
  it('grows with the impact, from silence to full, and never falls back', () => {
    for (const voice of VOICES) {
      expect(loudness(voice, 0)).toBe(0);
      expect(loudness(voice, SILENT_BELOW * 0.9)).toBe(0);
      let last = 0;
      for (let speed = 0.02; speed <= 12; speed *= 1.3) {
        const level = loudness(voice, speed);
        expect(level).toBeGreaterThanOrEqual(last);
        expect(level).toBeLessThanOrEqual(1);
        last = level;
      }
      expect(last).toBe(1);
    }
  });

  it('comes from the right event, and none from a change of motion', () => {
    expect(hitFor({ kind: 'stick', t: 0, ball: 0 }, 3)?.voice).toBe('cue');
    expect(hitFor({ kind: 'ball', t: 0.1, a: 0, b: 1, impact: 2 }, 3)?.voice).toBe('ball');
    expect(hitFor({ kind: 'cushion', t: 0.2, ball: 1, cushion: 2, impact: 1 }, 3)?.voice).toBe(
      'cushion',
    );
    expect(hitFor({ kind: 'jaw', t: 0.2, ball: 1, jaw: 2, impact: 1 }, 3)?.voice).toBe('jaw');
    const entry = { ...ballState(0.1, 0.1, 0), vx: 1.2, vy: 0.5, s: Motion.Rolling };
    const pocket = hitFor({ kind: 'pocket', t: 0.3, ball: 2, pocket: 0, entry }, 3);
    expect(pocket?.voice).toBe('pocket');
    expect(pocket!.level).toBeCloseTo(loudness('pocket', 1.3), 9);
    expect(
      hitFor({ kind: 'transition', t: 0.4, ball: 0, from: Motion.Sliding, to: Motion.Rolling }, 3),
    ).toBeNull();
    // Balls that barely touch make no sound.
    expect(hitFor({ kind: 'ball', t: 0.1, a: 0, b: 1, impact: 0.001 }, 3)).toBeNull();
  });
});

describe('the mixer', () => {
  it('folds a softer contact of the same kind landing within the window into the first', () => {
    const mixer = new HitMixer();
    expect(mixer.accept({ voice: 'ball', level: 0.8 }, 1)).toBe(true);
    expect(mixer.accept({ voice: 'ball', level: 0.5 }, 1 + MERGE_WINDOW / 2)).toBe(false);
    // A louder one, another kind, or one just outside the window plays.
    expect(mixer.accept({ voice: 'ball', level: 0.9 }, 1 + MERGE_WINDOW / 2)).toBe(true);
    expect(mixer.accept({ voice: 'cushion', level: 0.3 }, 1.001)).toBe(true);
    expect(mixer.accept({ voice: 'ball', level: 0.2 }, 1 + MERGE_WINDOW * 1.5)).toBe(true);
  });

  it('never lets more than the cap ring at once, and frees voices as they end', () => {
    const mixer = new HitMixer();
    let accepted = 0;
    for (let i = 0; i < 60; i++) {
      if (mixer.accept({ voice: 'pocket', level: 1 }, i * (MERGE_WINDOW * 1.1))) accepted++;
      expect(mixer.ringing(i * (MERGE_WINDOW * 1.1))).toBeLessThanOrEqual(MAX_VOICES);
    }
    expect(accepted).toBeGreaterThanOrEqual(MAX_VOICES);
    expect(accepted).toBeLessThan(60);
    expect(mixer.accept({ voice: 'pocket', level: 1 }, 100 + DURATION.pocket)).toBe(true);
  });
});

/** An AudioContext that only remembers what was asked of it. */
class FakeParam {
  value = 0;
  readonly calls: { kind: string; value: number; at: number }[] = [];
  setValueAtTime(value: number, at: number) {
    this.value = value;
    this.calls.push({ kind: 'set', value, at });
    return this;
  }
  exponentialRampToValueAtTime(value: number, at: number) {
    this.calls.push({ kind: 'ramp', value, at });
    return this;
  }
  setTargetAtTime(value: number, at: number) {
    this.value = value;
    this.calls.push({ kind: 'target', value, at });
    return this;
  }
}

class FakeNode {
  connect<T>(node: T): T {
    return node;
  }
}

class FakeContext {
  currentTime = 2;
  state = 'running';
  sampleRate = 8000;
  destination = new FakeNode();
  readonly gains: { gain: FakeParam }[] = [];
  readonly starts: number[] = [];
  createGain() {
    const node = Object.assign(new FakeNode(), { gain: new FakeParam() });
    this.gains.push(node);
    return node;
  }
  createBufferSource() {
    const starts = this.starts;
    return Object.assign(new FakeNode(), {
      buffer: null,
      loop: false,
      playbackRate: new FakeParam(),
      start(at = 0) {
        starts.push(at);
      },
      stop() {},
    });
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), {
      type: '',
      frequency: new FakeParam(),
      Q: new FakeParam(),
    });
  }
  createOscillator() {
    const starts = this.starts;
    return Object.assign(new FakeNode(), {
      type: '',
      frequency: new FakeParam(),
      start(at = 0) {
        starts.push(at);
      },
      stop() {},
    });
  }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

function setup() {
  const context = new FakeContext();
  const sound = new SoundManager(() => context as unknown as AudioContext, null);
  return { context, sound };
}

/** The loudest level any gain was set to at the start of the sounds made after `from`. */
const peak = (context: FakeContext, from: number) =>
  Math.max(
    ...context.gains
      .slice(from)
      .flatMap((g) => g.gain.calls.filter((c) => c.kind === 'set').map((c) => c.value)),
  );

describe('the synthesiser', () => {
  it('makes no sound while sound is off, and follows the volume', () => {
    const { context, sound } = setup();
    sound.configure(false, 0.6);
    sound.hit({ voice: 'ball', level: 1 });
    sound.cue('foul');
    expect(context.starts).toEqual([]);
    sound.configure(true, 0.6);
    sound.hit({ voice: 'ball', level: 1 });
    expect(context.starts.length).toBeGreaterThan(0);
    // The first gain made is the master volume.
    expect(context.gains[0]!.gain.value).toBeCloseTo(0.6, 9);
  });

  it('keeps the spacing of contacts within a frame, never before now', () => {
    const { context, sound } = setup();
    sound.hit({ voice: 'cushion', level: 0.5 }, 0.02);
    const first = Math.min(...context.starts);
    context.starts.length = 0;
    sound.hit({ voice: 'jaw', level: 0.5 }, 0);
    const second = Math.min(...context.starts);
    expect(second - first).toBeCloseTo(0.02, 9);
    expect(first).toBeGreaterThanOrEqual(context.currentTime);
    context.starts.length = 0;
    // A contact long past is played at once, not in the past.
    sound.hit({ voice: 'cue', level: 0.5 }, 5);
    expect(Math.min(...context.starts)).toBeGreaterThanOrEqual(context.currentTime);
  });

  it('plays a harder hit louder', () => {
    const { context, sound } = setup();
    sound.hit({ voice: 'ball', level: 0.1 });
    const soft = peak(context, 1);
    context.currentTime += 1;
    const mark = context.gains.length;
    sound.hit({ voice: 'ball', level: 0.9 });
    expect(peak(context, mark)).toBeGreaterThan(soft * 3);
  });

  it('caps the voices: contacts beyond the cap are dropped until voices end', () => {
    const { context, sound } = setup();
    // The first sound also sets up the master volume; get that out of the way.
    sound.cue('call');
    const gainsPerPocket = () => {
      const mark = context.gains.length;
      sound.hit({ voice: 'pocket', level: 0.7 });
      return context.gains.length - mark;
    };
    const each = gainsPerPocket();
    // Long-ringing pocket sounds, each just outside the merge window of the one before: all ring
    // together, so only the cap decides how many start.
    let started = 1;
    for (let i = 1; i < 30; i++) {
      context.currentTime += MERGE_WINDOW * 1.05;
      if (gainsPerPocket() > 0) started++;
    }
    expect(each).toBeGreaterThan(0);
    expect(started).toBe(MAX_VOICES);
    // Once they have rung out, there is room again.
    context.currentTime += DURATION.pocket + 0.1;
    expect(gainsPerPocket()).toBe(each);
  });
});
