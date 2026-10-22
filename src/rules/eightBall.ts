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

// The rules of 8-ball, after the WPA Rules of Play (effective 2026-10-21), sections 1–4, with the
// deviations listed in docs/rules.md. Pure functions of plain data: both players judge every shot
// themselves and reach the same verdict.

import type { ShotFacts } from './facts.ts';
import {
  type Choice,
  type Foul,
  type Group,
  type Intent,
  type RackState,
  type Ruling,
  type Seat,
  groupOf,
  SOLIDS,
  STRIPES,
} from './types.ts';

export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

/** A new rack, the breaker to break with the cue ball in hand above the head string (4.3a). */
export function newRack(breaker: Seat): RackState {
  return {
    phase: 'break',
    breaker,
    turn: breaker,
    groups: [0, 0],
    inHand: 'kitchen',
    decision: null,
    winner: null,
    end: null,
  };
}

/** Whether every ball of a group is off the table. `onTable[n]` is ball n's presence. */
export function groupCleared(group: Group, onTable: readonly boolean[]): boolean {
  if (group === 0) return false;
  const from = group === SOLIDS ? 1 : 9;
  for (let n = from; n < from + 7; n++) if (onTable[n]) return false;
  return true;
}

/** The balls the shooter may hit first, with the balls as they lie before the shot. */
export function legalTargets(state: RackState, onTable: readonly boolean[]): number[] {
  const out: number[] = [];
  if (state.phase === 'break') {
    for (let n = 1; n <= 15; n++) if (onTable[n]) out.push(n);
    return out;
  }
  const group = state.groups[state.turn];
  if (group === 0) {
    // Open table: anything but the 8, unless a group is gone (4.4: claim it, shoot the 8).
    const eight = groupCleared(SOLIDS, onTable) || groupCleared(STRIPES, onTable);
    for (let n = 1; n <= 15; n++) if (onTable[n] && (n !== 8 || eight)) out.push(n);
    return out;
  }
  if (groupCleared(group, onTable)) return onTable[8] ? [8] : [];
  for (let n = 1; n <= 15; n++) if (onTable[n] && groupOf(n) === group) out.push(n);
  return out;
}

/** Whether the shooter must call a pocket for the 8: the 8 is a legal ball to hit first. */
export function needsCall(state: RackState, onTable: readonly boolean[]): boolean {
  return state.phase === 'play' && legalTargets(state, onTable).includes(8);
}

export interface Judged {
  readonly state: RackState;
  readonly ruling: Ruling;
}

/**
 * Judges a shot. `before[n]` tells whether ball n was on the table when it was struck. Pocketed
 * balls stay down whatever happened (WPA 4.9); the 8 alone is spotted, after the break.
 */
export function judge(
  state: RackState,
  facts: ShotFacts,
  intent: Intent,
  before: readonly boolean[],
): Judged {
  if (state.phase === 'break') return judgeBreak(state, facts);
  if (state.phase !== 'play') throw new Error(`no shot is due in phase ${state.phase}`);
  const shooter = state.turn;
  const objects = facts.pocketed.map((p) => p.ball).filter((b) => b !== 0);
  const targets = legalTargets(state, before);

  const fouls: Foul[] = [];
  if (facts.scratch) fouls.push('scratch');
  if (facts.firstContact === null) fouls.push('noContact');
  else if (!targets.includes(facts.firstContact)) fouls.push('wrongBallFirst');
  if (facts.pocketed.length === 0 && facts.firstContact !== null && !facts.railAfterContact) {
    fouls.push('noRail');
  }
  if (state.inHand === 'kitchen' && !aboveHeadStringPlayedFairly(facts)) {
    fouls.push('badPlayAboveHeadString');
  }

  const eight = facts.pocketed.find((p) => p.ball === 8);
  if (eight) {
    // The shooter was entitled to the 8 if hitting it first was legal for them.
    const onEight = targets.includes(8);
    const end = fouls.length
      ? 'eightFoul'
      : !onEight
        ? 'eightEarly'
        : intent.pocket !== eight.pocket
          ? 'eightPocket'
          : 'eight';
    const winner = end === 'eight' ? shooter : other(shooter);
    return {
      state: { ...state, phase: 'over', winner, end, inHand: 'none', decision: null },
      ruling: { fouls, pocketed: objects, assigned: null, continues: false, spotEight: false },
    };
  }

  if (fouls.length) {
    return {
      state: { ...state, turn: other(shooter), inHand: 'table' },
      ruling: { fouls, pocketed: objects, assigned: null, continues: false, spotEight: false },
    };
  }

  let groups = state.groups;
  let assigned: Ruling['assigned'] = null;
  if (groups[shooter] === 0 && objects.length && !intent.safety) {
    // Deviation from 4.4 (no called balls): the first ball pocketed decides the shooter's group.
    const group = groupOf(objects[0]!) as Group;
    groups = shooter === 0 ? [group, (3 - group) as Group] : [(3 - group) as Group, group];
    assigned = { seat: shooter, group };
  }
  const mine = groups[shooter];
  const continues = !intent.safety && objects.some((b) => groupOf(b) === mine);
  return {
    state: { ...state, groups, turn: continues ? shooter : other(shooter), inHand: 'none' },
    ruling: { fouls, pocketed: objects, assigned, continues, spotEight: false },
  };
}

/** WPA 3.11: from in hand above the head string, cross it or first hit a ball on or below it. */
function aboveHeadStringPlayedFairly(facts: ShotFacts): boolean {
  return (
    facts.crossedHeadString || (facts.firstContact !== null && facts.firstContactBelowHeadString)
  );
}

function judgeBreak(state: RackState, facts: ShotFacts): Judged {
  const breaker = state.breaker;
  const incoming = other(breaker);
  const objects = facts.pocketed.map((p) => p.ball).filter((b) => b !== 0);
  const fouls: Foul[] = [];
  if (facts.scratch) fouls.push('scratch');
  if (!aboveHeadStringPlayedFairly(facts)) fouls.push('badPlayAboveHeadString');
  const legal = objects.length > 0 || facts.ballsToRail >= 4;
  const base = { fouls, pocketed: objects, assigned: null, spotEight: false, legalBreak: legal };

  if (!legal) {
    // 4.3(d): the incoming player chooses; if they accept after a scratch, the cue ball is in hand
    // above the head string.
    return {
      state: {
        ...state,
        phase: 'decision',
        decision: 'illegalBreak',
        turn: incoming,
        inHand: facts.scratch ? 'kitchen' : 'none',
      },
      ruling: { ...base, continues: false },
    };
  }
  if (objects.includes(8)) {
    // 4.3(e) and (f): the 8 on the break is spotted, or the rack is broken again.
    return fouls.length
      ? {
          state: { ...state, phase: 'decision', decision: 'eightOnFoulBreak', turn: incoming },
          ruling: { ...base, continues: false },
        }
      : {
          state: { ...state, phase: 'decision', decision: 'eightOnBreak', turn: breaker },
          ruling: { ...base, continues: true },
        };
  }
  if (fouls.length) {
    // 4.3(h): play passes, the cue ball in hand above the head string; the table stays open.
    return {
      state: { ...state, phase: 'play', turn: incoming, inHand: 'kitchen' },
      ruling: { ...base, continues: false },
    };
  }
  // 4.3(c): a ball pocketed keeps the breaker at the table; the table remains open.
  const continues = objects.length > 0;
  return {
    state: { ...state, phase: 'play', turn: continues ? breaker : incoming, inHand: 'none' },
    ruling: { ...base, continues },
  };
}

export interface Decided {
  readonly state: RackState;
  /** Start a new rack (with `state.breaker` breaking). */
  readonly rerack: boolean;
  /** Spot the 8 before play goes on (WPA 1.5). */
  readonly spotEight: boolean;
}

/** Applies the deciding player's choice (WPA 4.3). */
export function decide(state: RackState, choice: Choice): Decided {
  const decider = state.turn;
  switch (state.decision) {
    case 'illegalBreak':
      if (choice === 'accept') {
        return {
          state: { ...state, phase: 'play', decision: null },
          rerack: false,
          spotEight: false,
        };
      }
      if (choice === 'rerack') return { state: newRack(decider), rerack: true, spotEight: false };
      if (choice === 'rerackOther') {
        return { state: newRack(state.breaker), rerack: true, spotEight: false };
      }
      break;
    case 'eightOnBreak':
      if (choice === 'spot') {
        return {
          state: { ...state, phase: 'play', decision: null, inHand: 'none' },
          rerack: false,
          spotEight: true,
        };
      }
      if (choice === 'rebreak') return { state: newRack(decider), rerack: true, spotEight: false };
      break;
    case 'eightOnFoulBreak':
      if (choice === 'spot') {
        return {
          state: { ...state, phase: 'play', decision: null, inHand: 'kitchen' },
          rerack: false,
          spotEight: true,
        };
      }
      if (choice === 'rebreak') return { state: newRack(decider), rerack: true, spotEight: false };
      break;
  }
  throw new Error(`choice ${choice} does not answer ${state.decision ?? 'no decision'}`);
}

/**
 * The shot clock ran out (WPA 3.14): a standard foul, the cue ball in hand for the opponent. On
 * the break, where the table is untouched, the opponent breaks instead (a deviation; see
 * docs/rules.md).
 */
export function timeOut(state: RackState): RackState {
  if (state.phase === 'break') return newRack(other(state.breaker));
  if (state.phase !== 'play') return state;
  return { ...state, turn: other(state.turn), inHand: 'table' };
}

/** A player concedes the rack (WPA 1.12). */
export function concede(state: RackState, seat: Seat): RackState {
  return { ...state, phase: 'over', winner: other(seat), end: 'concede', decision: null };
}

/** The next rack of a match: the break alternates (WPA 1.3). */
export function nextRack(previous: RackState): RackState {
  return newRack(other(previous.breaker));
}
