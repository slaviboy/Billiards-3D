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

// The state of a rack of 8-ball and the words the rules speak in. Plain data, so it travels over
// the network and into saved games as it is. Ball 0 is the cue ball; ball n is numbered n.

import type { PocketId } from '../physics/types.ts';

export type Seat = 0 | 1;

/** 0: not yet assigned (the table is open), 1: solids (1–7), 2: stripes (9–15). */
export type Group = 0 | 1 | 2;

export const SOLIDS: Group = 1;
export const STRIPES: Group = 2;

export function groupOf(ball: number): Group | 8 {
  if (ball === 8) return 8;
  return ball >= 1 && ball <= 7 ? SOLIDS : STRIPES;
}

/** Where the incoming player may put the cue ball: nowhere (play it where it lies), above the
 * head string, or anywhere. */
export type InHand = 'none' | 'kitchen' | 'table';

/**
 * A choice the rules leave to a player (WPA 4.3):
 * - illegalBreak: the incoming player accepts the table, re-racks and breaks, or re-racks and
 *   has the offender break again;
 * - eightOnBreak: the breaker, who pocketed the 8 on a legal break, spots it and plays on, or
 *   breaks again;
 * - eightOnFoulBreak: the incoming player spots the 8 and plays with the cue ball in hand above
 *   the head string, or breaks again.
 */
export type DecisionKind = 'illegalBreak' | 'eightOnBreak' | 'eightOnFoulBreak';

export type Choice = 'accept' | 'rerack' | 'rerackOther' | 'spot' | 'rebreak';

export const CHOICES: Record<DecisionKind, readonly Choice[]> = {
  illegalBreak: ['accept', 'rerack', 'rerackOther'],
  eightOnBreak: ['spot', 'rebreak'],
  eightOnFoulBreak: ['spot', 'rebreak'],
};

export type Phase = 'break' | 'play' | 'decision' | 'over';

/** How a rack ended. */
export type RackEnd =
  | 'eight' // the winner pocketed the 8 legally
  | 'eightEarly' // the loser pocketed the 8 before clearing his group
  | 'eightFoul' // the loser pocketed the 8 and fouled
  | 'eightPocket' // the loser pocketed the 8 in a pocket he did not call
  | 'concede';

export interface RackState {
  readonly phase: Phase;
  /** Who broke this rack. */
  readonly breaker: Seat;
  /** Who shoots next (in 'decision', who decides). */
  readonly turn: Seat;
  /** Each seat's group; both 0 while the table is open. */
  readonly groups: readonly [Group, Group];
  readonly inHand: InHand;
  readonly decision: DecisionKind | null;
  readonly winner: Seat | null;
  readonly end: RackEnd | null;
}

/** What the shooter declares before the shot. */
export interface Intent {
  /** The pocket called for the 8; required when shooting at the 8 after the break. */
  readonly pocket: PocketId | null;
  /** A safety: play passes at the end of the shot, whatever is pocketed (WPA 2.16). */
  readonly safety: boolean;
}

/** The fouls this game can produce, by WPA rule number. */
export type Foul =
  | 'scratch' // 3.1
  | 'wrongBallFirst' // 3.2
  | 'noContact' // 3.3, no object ball touched at all
  | 'noRail' // 3.3
  | 'badPlayAboveHeadString' // 3.11
  | 'shotClock'; // 3.14

export interface Ruling {
  readonly fouls: readonly Foul[];
  /** Object balls the shot pocketed, in order. */
  readonly pocketed: readonly number[];
  /** A group assigned by this shot. */
  readonly assigned: { readonly seat: Seat; readonly group: Group } | null;
  /** Whether the shooter stays at the table. */
  readonly continues: boolean;
  /** Whether the shot was a legal break (on breaks only). */
  readonly legalBreak?: boolean;
  /** The 8 must be spotted before play goes on (WPA 1.5, 4.7). */
  readonly spotEight: boolean;
}
