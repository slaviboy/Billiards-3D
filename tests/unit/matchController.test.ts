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

// A match from rack to result: the break from in hand above the head string, shots judged by the
// rules, the cue ball in hand after a scratch, decisions, the score and the race; and two
// controllers fed the same shots reach the same table, bit for bit.

import { describe, expect, it } from 'vitest';
import { MatchController, type MatchSetup } from '../../src/game/MatchController.ts';
import { encodePlacement, encodeShot } from '../../src/game/shotCodec.ts';
import { Motion } from '../../src/physics/index.ts';

const setup = (over: Partial<MatchSetup> = {}): MatchSetup => ({
  mode: 'local',
  size: '9ft',
  race: 2,
  shotClock: 0,
  names: ['Ada', 'Bo'],
  seed: 'test-seed',
  firstBreak: 0,
  ...over,
});

const plain = { pocket: null, safety: false };

/** A hard break straight at the apex from the cue ball's spot. */
function breakShot(match: MatchController) {
  const cue = match.current.balls[0]!;
  const heading = Math.atan2(match.table.footSpot.y - cue.ry, match.table.footSpot.x - cue.rx);
  return encodeShot(heading, 0, 7, 0, -0.1);
}

describe('a match', () => {
  it('starts with the breaker in hand above the head string and a full rack', () => {
    const match = new MatchController(setup());
    const s = match.current;
    expect(s.rack).toMatchObject({ phase: 'break', turn: 0, inHand: 'kitchen' });
    expect(s.balls).toHaveLength(16);
    expect(match.inHand()).toBe('kitchen');
    expect(match.needsCall()).toBe(false);
  });

  it('keeps the cue ball above the head string for the break', () => {
    const match = new MatchController(setup());
    expect(match.placeCueBall(0.5, match.table.headString - 0.05)).toBe(true);
    expect(match.placeCueBall(0.5, match.table.headString + 0.05)).toBe(false);
    expect(match.current.balls[0]!.rx).toBe(0.5);
  });

  it('plays the break, judges it and counts the shot', () => {
    const match = new MatchController(setup());
    const result = match.shoot(breakShot(match), plain);
    expect(result.ruling?.legalBreak).toBe(true);
    expect(match.current.shot).toBe(1);
    expect(['play', 'decision']).toContain(match.current.rack.phase);
    expect(result.timeline.events.length).toBeGreaterThan(20);
  });

  it('refuses a shot when a decision or the end of the match is pending', () => {
    const match = new MatchController(setup());
    match.concede(1);
    expect(() => match.shoot(breakShot(match), plain)).toThrow();
  });

  it('places a placement given with the shot, and refuses an illegal one', () => {
    const match = new MatchController(setup());
    const bad = encodePlacement(0.6, match.table.headString + 0.2);
    expect(() => match.shoot(breakShot(match), plain, bad)).toThrow();
    const good = encodePlacement(0.6, match.table.headString - 0.2);
    match.shoot(breakShot(match), plain, good);
    expect(match.current.shot).toBe(1);
  });

  it('scores conceded racks, alternates the break and ends at the race', () => {
    const match = new MatchController(setup({ race: 2 }));
    match.concede(1);
    expect(match.current.score).toEqual([1, 0]);
    expect(match.current.winner).toBeNull();
    match.nextRack();
    expect(match.current.rack).toMatchObject({ phase: 'break', breaker: 1, turn: 1 });
    expect(match.current.rackNumber).toBe(2);
    match.concede(1);
    expect(match.current.score).toEqual([2, 0]);
    expect(match.current.winner).toBe(0);
  });

  it('brings a scratched cue ball back in hand in practice', () => {
    const match = new MatchController(setup({ mode: 'practice' }));
    // Straight into the head-left corner from close by.
    match.placeCueBall(0.25, 0.25);
    match.shoot(encodeShot((225 * Math.PI) / 180, 0, 1.2, 0, 0), plain);
    const cue = match.current.balls[0]!;
    expect(cue.s).toBe(Motion.Stationary);
    expect(match.inHand()).toBe('table');
  });

  it('reaches the same table in two games fed the same shots', () => {
    const a = new MatchController(setup());
    const b = new MatchController(setup());
    for (const match of [a, b]) match.shoot(breakShot(match), plain);
    expect(a.hash()).toBe(b.hash());
    // A different seed racks differently.
    const c = new MatchController(setup({ seed: 'another' }));
    c.shoot(breakShot(c), plain);
    expect(c.hash()).not.toBe(a.hash());
  });

  it('answers a break decision: re-rack for the chooser, or spot the 8', () => {
    const match = new MatchController(setup());
    // A feather-soft break: an illegal break leaves the incoming player the choice.
    match.shoot(encodeShot(Math.PI / 2, 0, 0.3, 0, 0), plain);
    const s = match.current;
    expect(s.rack).toMatchObject({ phase: 'decision', decision: 'illegalBreak', turn: 1 });
    match.decide('rerack');
    expect(match.current.rack).toMatchObject({ phase: 'break', breaker: 1 });
    expect(match.current.balls.every((ball) => ball.s === Motion.Stationary)).toBe(true);
  });
});
