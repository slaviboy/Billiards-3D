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

// A match of 8-ball: who plays, the race to so many racks, the rules' state, where the balls are,
// and how a shot changes all of that. It knows nothing of the screen: the interface shows its
// state, plays each shot's timeline, and only then shows the state the shot led to. Online, the
// other player's shots come through the same shoot(), so both players' games run the same code
// on the same numbers.

import { Store } from '../core/Store.ts';
import { decodeShot, decodePlacement, type Placement, type ShotCode } from './shotCodec.ts';
import {
  copyState,
  Motion,
  simulate,
  stateHash,
  type BallState,
  type Timeline,
} from '../physics/index.ts';
import type { PocketId } from '../physics/types.ts';
import {
  concede as concedeRack,
  decide as decideRack,
  judge,
  needsCall,
  newRack,
  nextRack,
  other,
  timeOut as timeOutRack,
} from '../rules/eightBall.ts';
import { shotFacts, type ShotFacts } from '../rules/facts.ts';
import type { Choice, Intent, RackState, Ruling, Seat } from '../rules/types.ts';
import { buildTable, type TableGeometry } from '../table/geometry.ts';
import { canPlace, spotPosition } from '../table/placement.ts';
import { breakSpot, rackBalls, seedFrom } from '../table/rack.ts';
import { BALL_RADIUS, tableSpec, type TableSize } from '../table/spec.ts';

export type MatchMode = 'practice' | 'local' | 'online';

export interface MatchSetup {
  readonly mode: MatchMode;
  readonly size: TableSize;
  /** Racks needed to win the match. */
  readonly race: number;
  /** Seconds per shot; 0 for none. */
  readonly shotClock: number;
  readonly names: readonly [string, string];
  /** Shared by both players: decides the racks. */
  readonly seed: string;
  readonly firstBreak: Seat;
}

export interface MatchState {
  readonly setup: MatchSetup;
  readonly rack: RackState;
  /** 1 for the first rack. */
  readonly rackNumber: number;
  readonly score: readonly [number, number];
  /** Shots played in the match so far (the next shot's number). */
  readonly shot: number;
  readonly balls: readonly Readonly<BallState>[];
  /** The last shot's verdict, for the interface to announce. */
  readonly ruling: Ruling | null;
  /** The match's winner, once someone has won the race. */
  readonly winner: Seat | null;
}

export interface ShotResult {
  readonly timeline: Timeline;
  readonly facts: ShotFacts;
  readonly ruling: Ruling | null;
  /** The state to show once the shot has played. */
  readonly state: MatchState;
}

export class MatchController {
  readonly state: Store<MatchState>;
  table: TableGeometry;

  constructor(setup: MatchSetup) {
    this.table = buildTable(tableSpec(setup.size));
    this.state = new Store(this.freshMatch(setup));
  }

  get current(): MatchState {
    return this.state.get();
  }

  /** Starts a new match (or a rematch) with these terms. */
  start(setup: MatchSetup): void {
    this.table = buildTable(tableSpec(setup.size));
    this.state.set(this.freshMatch(setup));
  }

  private freshMatch(setup: MatchSetup): MatchState {
    return {
      setup,
      rack: newRack(setup.firstBreak),
      rackNumber: 1,
      score: [0, 0],
      shot: 0,
      balls: rackBalls(this.table, seedFrom(`${setup.seed}:1`)),
      ruling: null,
      winner: null,
    };
  }

  /** Which balls are on the table (index = number). */
  onTable(state: MatchState = this.current): boolean[] {
    return state.balls.map((b) => b.s !== Motion.Pocketed);
  }

  /** Where the cue ball may be put now, or null if it must be played where it lies. */
  inHand(state: MatchState = this.current): 'kitchen' | 'table' | null {
    if (state.setup.mode === 'practice') return 'table';
    const hand = state.rack.inHand;
    return hand === 'none' ? null : hand;
  }

  /** Whether the shot about to be played must name the 8's pocket. */
  needsCall(state: MatchState = this.current): boolean {
    return state.setup.mode !== 'practice' && needsCall(state.rack, this.onTable(state));
  }

  canPlaceCueBall(x: number, y: number): boolean {
    const where = this.inHand();
    return where !== null && canPlace(this.table, this.current.balls, 0, x, y, where);
  }

  /** Moves the cue ball in hand (the player dragging it); false if it cannot go there. */
  placeCueBall(x: number, y: number): boolean {
    if (!this.canPlaceCueBall(x, y)) return false;
    this.state.update({ balls: this.withCueBallAt(this.current.balls, x, y) });
    return true;
  }

  private withCueBallAt(balls: readonly Readonly<BallState>[], x: number, y: number): BallState[] {
    const next = balls.map(copyState);
    const cue = next[0]!;
    cue.rx = x;
    cue.ry = y;
    cue.rz = BALL_RADIUS;
    cue.s = Motion.Stationary;
    cue.vx = cue.vy = cue.vz = cue.wx = cue.wy = cue.wz = 0;
    return next;
  }

  /**
   * Plays a shot: from the cue ball where it lies (or at `placement`, if it is in hand), struck
   * as `code` says. Returns the timeline to play and the state that follows; the state is
   * committed at once (so a second shot cannot slip in), but the interface shows it only when the
   * timeline has played.
   */
  shoot(code: ShotCode, intent: Intent, placement: Placement | null = null): ShotResult {
    const before = this.current;
    if (before.winner !== null || (before.rack.phase !== 'break' && before.rack.phase !== 'play')) {
      throw new Error('no shot is due');
    }
    let balls = before.balls.map(copyState);
    if (placement) {
      const at = decodePlacement(placement);
      if (!this.canPlaceCueBall(at.x, at.y)) throw new Error('the cue ball cannot be placed there');
      balls = this.withCueBallAt(balls, at.x, at.y);
    } else if (balls[0]!.s === Motion.Pocketed) {
      throw new Error('the cue ball is in hand and must be placed');
    }
    const onTableBefore = balls.map((b) => b.s !== Motion.Pocketed);
    const timeline = simulate(balls, decodeShot(code), this.table.physics);
    const facts = shotFacts(timeline, balls, this.table.headString);
    let finalBalls = timeline.final.map(copyState);

    if (before.setup.mode === 'practice') {
      // Free play: the shooter plays on; a scratched cue ball comes back in hand.
      if (finalBalls[0]!.s === Motion.Pocketed)
        finalBalls = this.cueBallInHand(finalBalls, 'table');
      const state: MatchState = {
        ...before,
        balls: finalBalls,
        shot: before.shot + 1,
        ruling: null,
      };
      this.state.set(state);
      return { timeline, facts, ruling: null, state };
    }

    const { state: rack, ruling } = judge(before.rack, facts, intent, onTableBefore);
    // A scratched cue ball waits in hand where the next player will place it.
    if (finalBalls[0]!.s === Motion.Pocketed && rack.inHand !== 'none') {
      finalBalls = this.cueBallInHand(finalBalls, rack.inHand);
    }
    let state: MatchState = { ...before, rack, balls: finalBalls, shot: before.shot + 1, ruling };
    if (rack.phase === 'over') state = this.scoreRack(state);
    this.state.set(state);
    return { timeline, facts, ruling, state };
  }

  /** Puts a pocketed cue ball back in hand at a free spot for the incoming player to move. */
  private cueBallInHand(balls: BallState[], where: 'kitchen' | 'table'): BallState[] {
    const start = breakSpot(this.table);
    const candidates = [start, { x: this.table.headSpot.x, y: this.table.headSpot.y - 0.25 }];
    for (let k = 1; k < 40; k++)
      candidates.push({ x: start.x + ((k % 2) * 2 - 1) * k * 0.03, y: start.y });
    for (const c of candidates) {
      if (canPlace(this.table, balls, 0, c.x, c.y, where))
        return this.withCueBallAt(balls, c.x, c.y);
    }
    return balls;
  }

  private scoreRack(state: MatchState): MatchState {
    const winner = state.rack.winner!;
    const score: [number, number] = [state.score[0], state.score[1]];
    score[winner]++;
    return { ...state, score, winner: score[winner] >= state.setup.race ? winner : null };
  }

  /** The deciding player's answer to a choice the break left (WPA 4.3). */
  decide(choice: Choice): void {
    const before = this.current;
    const decided = decideRack(before.rack, choice);
    let balls = before.balls.map(copyState);
    if (decided.rerack) balls = this.newRackBalls(before.rackNumber, decided.state.breaker);
    if (decided.spotEight) balls = this.spotEight(balls);
    if (!decided.rerack && decided.state.inHand !== 'none' && balls[0]!.s === Motion.Pocketed) {
      balls = this.cueBallInHand(balls, decided.state.inHand);
    }
    this.state.set({ ...before, rack: decided.state, balls, ruling: null });
  }

  private spotEight(balls: BallState[]): BallState[] {
    const at = spotPosition(this.table, balls, 8);
    const eight = balls[8]!;
    eight.rx = at.x;
    eight.ry = at.y;
    eight.rz = BALL_RADIUS;
    eight.s = Motion.Stationary;
    eight.vx = eight.vy = eight.vz = eight.wx = eight.wy = eight.wz = 0;
    return balls;
  }

  private newRackBalls(rackNumber: number, breaker: Seat): BallState[] {
    return rackBalls(
      this.table,
      seedFrom(`${this.current.setup.seed}:${rackNumber}:${breaker}:re`),
    );
  }

  /** After a rack is over: the next one, the break alternating (WPA 1.3). */
  nextRack(): void {
    const before = this.current;
    if (before.rack.phase !== 'over' || before.winner !== null) return;
    const rackNumber = before.rackNumber + 1;
    this.state.set({
      ...before,
      rack: nextRack(before.rack),
      rackNumber,
      balls: rackBalls(this.table, seedFrom(`${before.setup.seed}:${rackNumber}`)),
      ruling: null,
    });
  }

  /** The shot clock ran out (WPA 3.14). */
  timeOut(): void {
    const before = this.current;
    const rack = timeOutRack(before.rack);
    let balls = before.balls.map(copyState);
    if (rack.phase === 'break' && before.rack.phase === 'break') {
      balls = rackBalls(this.table, seedFrom(`${before.setup.seed}:${before.rackNumber}`));
    }
    this.state.set({
      ...before,
      rack,
      balls,
      ruling: {
        fouls: ['shotClock'],
        pocketed: [],
        assigned: null,
        continues: false,
        spotEight: false,
      },
    });
  }

  /** A player concedes the rack (WPA 1.12). */
  concede(seat: Seat): void {
    const before = this.current;
    if (before.rack.phase === 'over') return;
    this.state.set(
      this.scoreRack({ ...before, rack: concedeRack(before.rack, seat), ruling: null }),
    );
  }

  /** Whose turn it is (the decider while a decision is pending). */
  get turn(): Seat {
    return this.current.rack.turn;
  }

  /** The table's fingerprint with the rules' state: equal on both players' computers. */
  hash(state: MatchState = this.current): string {
    const r = state.rack;
    return stateHash(state.balls, [
      state.shot,
      state.rackNumber,
      state.score[0],
      state.score[1],
      ['break', 'play', 'decision', 'over'].indexOf(r.phase),
      r.breaker,
      r.turn,
      r.groups[0],
      r.groups[1],
      ['none', 'kitchen', 'table'].indexOf(r.inHand),
      r.decision === null
        ? -1
        : ['illegalBreak', 'eightOnBreak', 'eightOnFoulBreak'].indexOf(r.decision),
    ]);
  }

  /** The other player. */
  static other(seat: Seat): Seat {
    return other(seat);
  }
}

export type { Intent, PocketId };
