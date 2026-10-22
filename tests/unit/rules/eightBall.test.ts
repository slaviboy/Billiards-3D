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

// The 8-ball rules, branch by branch (WPA Rules of Play 4.3–4.9, with the deviations in
// docs/rules.md), from facts given directly; facts.test.ts derives facts from real shots.

import { describe, expect, it } from 'vitest';
import type { ShotFacts } from '../../../src/rules/facts.ts';
import {
  concede,
  decide,
  judge,
  legalTargets,
  needsCall,
  newRack,
  nextRack,
  timeOut,
} from '../../../src/rules/eightBall.ts';
import type { Intent, RackState } from '../../../src/rules/types.ts';
import type { PocketId } from '../../../src/physics/types.ts';

const all = (): boolean[] => new Array<boolean>(16).fill(true);
const without = (...balls: number[]) => {
  const on = all();
  for (const b of balls) on[b] = false;
  return on;
};

function facts(over: Partial<ShotFacts> = {}): ShotFacts {
  return {
    firstContact: 1,
    firstContactTime: 0.5,
    railAfterContact: true,
    pocketed: [],
    scratch: false,
    ballsToRail: 0,
    crossedHeadString: true,
    firstContactBelowHeadString: true,
    ...over,
  };
}

const plain: Intent = { pocket: null, safety: false };
const pockets = (...pairs: [number, PocketId][]) =>
  pairs.map(([ball, pocket]) => ({ ball, pocket }));

function playing(over: Partial<RackState> = {}): RackState {
  return { ...newRack(0), phase: 'play', inHand: 'none', ...over };
}

describe('the break (4.3)', () => {
  const rack = newRack(0);

  it('starts with the breaker, cue ball in hand above the head string, table open', () => {
    expect(rack).toMatchObject({ phase: 'break', turn: 0, inHand: 'kitchen', groups: [0, 0] });
  });

  it('keeps a breaker who pocketed a ball at the table, the table still open (c)', () => {
    const { state, ruling } = judge(
      rack,
      facts({ pocketed: pockets([3, 2]), ballsToRail: 5 }),
      plain,
      all(),
    );
    expect(ruling.legalBreak).toBe(true);
    expect(state).toMatchObject({ phase: 'play', turn: 0, groups: [0, 0], inHand: 'none' });
  });

  it('passes the table on a legal break that pockets nothing', () => {
    const { state } = judge(rack, facts({ ballsToRail: 4 }), plain, all());
    expect(state).toMatchObject({ phase: 'play', turn: 1, inHand: 'none' });
  });

  it('offers the incoming player the illegal-break options (d)', () => {
    const { state, ruling } = judge(rack, facts({ ballsToRail: 3 }), plain, all());
    expect(ruling.legalBreak).toBe(false);
    expect(state).toMatchObject({ phase: 'decision', decision: 'illegalBreak', turn: 1 });
    expect(decide(state, 'accept').state).toMatchObject({ phase: 'play', turn: 1, inHand: 'none' });
    expect(decide(state, 'rerack')).toMatchObject({
      rerack: true,
      state: { phase: 'break', breaker: 1 },
    });
    expect(decide(state, 'rerackOther')).toMatchObject({ rerack: true, state: { breaker: 0 } });
  });

  it('gives the cue ball in hand above the head string when an illegal break also scratched', () => {
    const { state } = judge(
      rack,
      facts({ ballsToRail: 2, scratch: true, pocketed: pockets([0, 5]) }),
      plain,
      all(),
    );
    // A scratch pockets a ball, but only object balls make a break legal.
    expect(state.decision).toBe('illegalBreak');
    expect(decide(state, 'accept').state.inHand).toBe('kitchen');
  });

  it('lets the breaker spot the 8 or break again after pocketing it legally (e)', () => {
    const { state } = judge(
      rack,
      facts({ pocketed: pockets([8, 3]), ballsToRail: 6 }),
      plain,
      all(),
    );
    expect(state).toMatchObject({ phase: 'decision', decision: 'eightOnBreak', turn: 0 });
    expect(decide(state, 'spot')).toMatchObject({
      spotEight: true,
      state: { phase: 'play', turn: 0, inHand: 'none' },
    });
    expect(decide(state, 'rebreak').state).toMatchObject({ phase: 'break', breaker: 0 });
  });

  it('gives the opponent the choice when the 8 falls on a foul break (f)', () => {
    const { state } = judge(
      rack,
      facts({ pocketed: pockets([8, 3], [0, 0]), scratch: true, ballsToRail: 6 }),
      plain,
      all(),
    );
    expect(state).toMatchObject({ decision: 'eightOnFoulBreak', turn: 1 });
    expect(decide(state, 'spot')).toMatchObject({
      spotEight: true,
      state: { turn: 1, inHand: 'kitchen' },
    });
    expect(decide(state, 'rebreak').state).toMatchObject({ phase: 'break', breaker: 1 });
  });

  it('gives the cue ball in hand above the head string after a scratch on a legal break (h)', () => {
    const { state, ruling } = judge(
      rack,
      facts({ pocketed: pockets([5, 1], [0, 3]), scratch: true, ballsToRail: 5 }),
      plain,
      all(),
    );
    expect(ruling.fouls).toEqual(['scratch']);
    expect(state).toMatchObject({ phase: 'play', turn: 1, inHand: 'kitchen', groups: [0, 0] });
  });

  it('rejects an answer that does not fit the decision', () => {
    const { state } = judge(rack, facts({ ballsToRail: 1 }), plain, all());
    expect(() => decide(state, 'spot')).toThrow();
  });
});

describe('open table and groups (4.4, 4.5)', () => {
  it('lets any ball but the 8 be hit first on an open table', () => {
    const targets = legalTargets(playing(), all());
    expect(targets).not.toContain(8);
    expect(targets).toHaveLength(14);
  });

  it('allows the 8 first on an open table once a group is gone, and asks for its pocket', () => {
    const on = without(1, 2, 3, 4, 5, 6, 7);
    expect(legalTargets(playing(), on)).toContain(8);
    expect(needsCall(playing(), on)).toBe(true);
    expect(needsCall(playing(), all())).toBe(false);
  });

  it('fouls hitting the 8 first on an open table', () => {
    const { state, ruling } = judge(playing(), facts({ firstContact: 8 }), plain, all());
    expect(ruling.fouls).toEqual(['wrongBallFirst']);
    expect(state).toMatchObject({ turn: 1, inHand: 'table' });
  });

  it('assigns the group of the first ball pocketed, and the shooter plays on', () => {
    const { state, ruling } = judge(
      playing(),
      facts({ firstContact: 11, pocketed: pockets([11, 2], [4, 3]) }),
      plain,
      all(),
    );
    expect(ruling.assigned).toEqual({ seat: 0, group: 2 });
    expect(state).toMatchObject({ groups: [2, 1], turn: 0 });
  });

  it('assigns nothing on a foul or a safety', () => {
    expect(
      judge(playing(), facts({ pocketed: pockets([3, 1], [0, 2]), scratch: true }), plain, all())
        .ruling.assigned,
    ).toBeNull();
    const safe = judge(
      playing(),
      facts({ pocketed: pockets([3, 1]) }),
      { pocket: null, safety: true },
      all(),
    );
    expect(safe.ruling.assigned).toBeNull();
    expect(safe.state).toMatchObject({ turn: 1, groups: [0, 0], inHand: 'none' });
  });

  it('keeps the shooter at the table only for a ball of their own group', () => {
    const state = playing({ groups: [1, 2] });
    expect(
      judge(state, facts({ firstContact: 2, pocketed: pockets([2, 0]) }), plain, all()).state.turn,
    ).toBe(0);
    expect(
      judge(state, facts({ firstContact: 2, pocketed: pockets([12, 0]) }), plain, all()).state.turn,
    ).toBe(1);
    expect(judge(state, facts({ firstContact: 2 }), plain, all()).state).toMatchObject({
      turn: 1,
      inHand: 'none',
    });
  });
});

describe('fouls (3, 4.9)', () => {
  const state = playing({ groups: [1, 2] });

  it('fouls a scratch, the next player taking the cue ball in hand anywhere', () => {
    const { state: next, ruling } = judge(
      state,
      facts({ pocketed: pockets([0, 4]), scratch: true }),
      plain,
      all(),
    );
    expect(ruling.fouls).toEqual(['scratch']);
    expect(next).toMatchObject({ turn: 1, inHand: 'table' });
  });

  it("fouls hitting the opponent's ball first", () => {
    expect(judge(state, facts({ firstContact: 10 }), plain, all()).ruling.fouls).toEqual([
      'wrongBallFirst',
    ]);
  });

  it('fouls missing every ball, and contact with no rail after it', () => {
    expect(judge(state, facts({ firstContact: null }), plain, all()).ruling.fouls).toEqual([
      'noContact',
    ]);
    expect(judge(state, facts({ railAfterContact: false }), plain, all()).ruling.fouls).toEqual([
      'noRail',
    ]);
    // A ball pocketed needs no rail.
    expect(
      judge(state, facts({ railAfterContact: false, pocketed: pockets([1, 2]) }), plain, all())
        .ruling.fouls,
    ).toEqual([]);
  });

  it('keeps balls pocketed on a foul down, and lists every foul', () => {
    const { ruling } = judge(
      state,
      facts({ firstContact: 9, pocketed: pockets([3, 1], [0, 1]), scratch: true }),
      plain,
      all(),
    );
    expect(ruling.pocketed).toEqual([3]);
    expect(ruling.fouls).toEqual(['scratch', 'wrongBallFirst']);
  });

  it('fouls a shot from above the head string that neither crosses it nor hits a ball beyond it (3.11)', () => {
    const kitchen = playing({ groups: [1, 2], inHand: 'kitchen' });
    const bad = facts({ crossedHeadString: false, firstContactBelowHeadString: false });
    expect(judge(kitchen, bad, plain, all()).ruling.fouls).toContain('badPlayAboveHeadString');
    const fair = facts({ crossedHeadString: false, firstContactBelowHeadString: true });
    expect(judge(kitchen, fair, plain, all()).ruling.fouls).toEqual([]);
  });

  it('fouls a timed-out shot, and has the opponent break when the breaker times out', () => {
    expect(timeOut(state)).toMatchObject({ turn: 1, inHand: 'table' });
    expect(timeOut(newRack(0))).toMatchObject({ phase: 'break', breaker: 1, turn: 1 });
  });
});

describe('the 8 and the end of the rack (4.8)', () => {
  const onEight = playing({ groups: [1, 2] });
  const cleared = without(1, 2, 3, 4, 5, 6, 7);
  const call = (pocket: PocketId): Intent => ({ pocket, safety: false });

  it('needs a called pocket once the group is cleared', () => {
    expect(legalTargets(onEight, cleared)).toEqual([8]);
    expect(needsCall(onEight, cleared)).toBe(true);
  });

  it('wins with the 8 legally in the called pocket', () => {
    const { state } = judge(
      onEight,
      facts({ firstContact: 8, pocketed: pockets([8, 3]) }),
      call(3),
      cleared,
    );
    expect(state).toMatchObject({ phase: 'over', winner: 0, end: 'eight' });
  });

  it('loses with the 8 in another pocket', () => {
    const { state } = judge(
      onEight,
      facts({ firstContact: 8, pocketed: pockets([8, 2]) }),
      call(3),
      cleared,
    );
    expect(state).toMatchObject({ winner: 1, end: 'eightPocket' });
  });

  it('loses with the 8 and a foul', () => {
    const { state } = judge(
      onEight,
      facts({ firstContact: 8, pocketed: pockets([8, 3], [0, 1]), scratch: true }),
      call(3),
      cleared,
    );
    expect(state).toMatchObject({ winner: 1, end: 'eightFoul' });
  });

  it('loses with the 8 before the group is cleared, even with the last ball on the same shot', () => {
    const lastBall = without(1, 2, 3, 4, 5, 6); // 7 still up
    const { state } = judge(
      onEight,
      facts({ firstContact: 7, pocketed: pockets([7, 1], [8, 3]) }),
      call(3),
      lastBall,
    );
    expect(state).toMatchObject({ winner: 1, end: 'eightEarly' });
  });

  it('lets an open-table shooter claim a cleared group and win on the 8', () => {
    const { state } = judge(
      playing(),
      facts({ firstContact: 8, pocketed: pockets([8, 0]) }),
      call(0),
      cleared,
    );
    expect(state).toMatchObject({ winner: 0, end: 'eight' });
  });

  it('ends the rack on a concession and alternates the next break', () => {
    const over = concede(onEight, 0);
    expect(over).toMatchObject({ phase: 'over', winner: 1, end: 'concede' });
    expect(nextRack(newRack(0))).toMatchObject({ phase: 'break', breaker: 1, turn: 1 });
  });
});
