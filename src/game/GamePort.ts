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

// 8-ball's side of an online session (the session is src/net/OnlineSession.ts; this is its
// GamePort). It hears the local player's shots, decisions and time-outs from the match and turns
// them into messages; it checks everything the other player sends against this device's own match
// before playing it (whose turn, which shot, legal values, a placement allowed where it is, the 8's
// pocket called exactly when it is due), simulates it here, judges it here, and compares the table
// it led to with the sender's fingerprint. It also shows the other player's cue from their
// previews and sends this player's, at most eight times a second.
//
// It keeps both shot clocks, from the same moment on both devices: a turn's clock starts once every
// shot so far could have played out at normal speed, whatever either screen is doing (a faster
// playback, or a tab in the background that has stopped drawing). On this player's turn the port
// calls time itself when the clock runs out, and says so. On the other player's turn it waits for
// their app to do the same; one that lets the clock run past the limit, the measured network
// delay and a grace has stopped keeping it.

import {
  browserTimers,
  type ForfeitReason,
  type GameListener,
  type GamePort,
  type GameStatus,
  type Receipt,
  type Restored,
  type RestoreReason,
  type Role,
  type Timers,
} from '../net/OnlineSession.ts';
import { other } from '../rules/eightBall.ts';
import { CHOICES, type Choice, type Intent, type Seat } from '../rules/types.ts';
import {
  rematchTerms,
  setupFor,
  shotInRange,
  shotMessage,
  stateFromSync,
  syncMessage,
  type GameMessage,
  type PoolTerms,
  type ShotMessage,
  type SyncMessage,
} from './gameMessages.ts';
import {
  MatchController,
  type MatchAction,
  type MatchSetup,
  type MatchState,
  type ShotResult,
} from './MatchController.ts';
import { decodePlacement, isShotCode, type Placement, type ShotCode } from './shotCodec.ts';
import type { PocketId } from '../physics/types.ts';

/** The cue as it is being lined up: the shot's integers and how far it is drawn back (0–1). */
export interface CueAim {
  readonly code: ShotCode;
  readonly pull: number;
}

/** What the port needs of the table on this device: the match, its playback and its view. */
export interface PortTable {
  readonly match: MatchController;
  /** A shot is being played out on the screen. */
  readonly playing: boolean;
  /** Starts a match; `localSeats` are the seats this device plays. */
  newMatch(setup: MatchSetup, localSeats: readonly Seat[]): Promise<void>;
  /** Lets this device play these seats from now on (none while play is held). */
  setLocalSeats(seats: readonly Seat[]): void;
  /** Plays a shot through the match and shows it; resolves once it has played. */
  shoot(code: ShotCode, intent: Intent, placement: Placement | null): Promise<ShotResult>;
  /** What follows a shot the other player made: the notes, a decision, the end of a rack. */
  afterShot(result: ShotResult): void;
  /** Shows the match's table as it is now (after a decision, a time-out or a table taken). */
  showBalls(): void;
  aimAtRack(): void;
  /** The local player's cue, as it would be sent. */
  localAim(): CueAim;
  /** Shows the other player's cue where their preview puts it, or stops showing it. */
  showRemoteAim(aim: CueAim | null): void;
  /** A note for the player. */
  say(text: string): void;
  /** The table was replaced by the host's: whatever it asks of this player next (a decision). */
  restored?(): void;
}

/** Previews go out at most this often. */
export const PREVIEW_MS = 125;
/** How long a shot can take to play out beyond its simulated time (balls settling in a pocket). */
export const PLAYBACK_TAIL_MS = 1000;
/** How far past the limit (and the network allowance) the other player's clock may run. */
export const STALL_GRACE_MS = 5000;

const CHOSE: Record<Choice, string> = {
  accept: 'plays the table as it lies',
  rerack: 're-racks and breaks',
  rerackOther: 're-racks; the breaker breaks again',
  spot: 'spots the 8 and plays on',
  rebreak: 're-racks and breaks again',
};

export interface PortOptions {
  readonly timers?: Timers;
  /** Milliseconds, for the shot clock; performance.now() by default. */
  readonly now?: () => number;
}

/** The local player's last action, kept to send again if the other side never heard it. */
interface OwnAction {
  readonly action: MatchAction;
  readonly message: GameMessage;
}

export class PoolPort implements GamePort<GameMessage, PoolTerms> {
  private readonly timers: Timers;
  private readonly now: () => number;
  private readonly listeners = new Set<GameListener<GameMessage>>();
  private readonly offs: Array<() => void> = [];
  private started = false;
  private mySeat: Seat = 0;
  private held = false;
  private allowance = 0;
  private lastOwn: OwnAction | null = null;
  /** When every shot so far could have played out, one after another, at normal speed. */
  private playbackEnd = -Infinity;
  /** The turn being timed: which, whether it is this player's, since when, and its timer. */
  private clock: { key: string; mine: boolean; since: number; timer: unknown } | null = null;
  /** The last preview sent, to send only changes. */
  private sentAim = '';
  private sentPlace = '';
  private readonly previewTimer: unknown;

  constructor(
    private readonly table: PortTable,
    options: PortOptions = {},
  ) {
    this.timers = options.timers ?? browserTimers;
    this.now = options.now ?? (() => performance.now());
    const match = table.match;
    this.offs.push(
      match.onAction((action) => this.onAction(action)),
      match.state.subscribe(() => this.onState()),
    );
    this.previewTimer = this.timers.setInterval(() => this.preview(), PREVIEW_MS);
  }

  /** The seat this device plays. */
  get seat(): Seat {
    return this.mySeat;
  }

  /** Stops listening to the match and stops the previews (the session is over). */
  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.timers.clearInterval(this.previewTimer);
    this.stopClock();
    this.listeners.clear();
    this.started = false;
  }

  // --- GamePort ------------------------------------------------------------------------------

  async start(terms: PoolTerms, role: Role): Promise<void> {
    this.mySeat = role === 'host' ? terms.host : other(terms.host);
    this.started = true;
    this.held = false;
    this.lastOwn = null;
    this.playbackEnd = -Infinity;
    this.sentAim = this.sentPlace = '';
    this.stopClock();
    await this.table.newMatch(setupFor(terms), [this.mySeat]);
    this.onState();
  }

  rematchTerms(terms: PoolTerms): PoolTerms {
    return rematchTerms(terms);
  }

  onLocal(listener: GameListener<GameMessage>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async receive(message: GameMessage): Promise<Receipt> {
    if (!this.online()) return { kind: 'shown' };
    switch (message.t) {
      case 'shot':
        return this.remoteShot(message);
      case 'decide':
        return this.remoteDecision(message.n, message.choice);
      case 'timeout':
        return this.remoteTimeout(message.n);
      case 'aim': {
        const { pull, t: _t, ...code } = message;
        // An honest app never sends a cue it could not play.
        if (!isShotCode(code)) return violation('sent a cue outside what the cue can do');
        if (this.previewing()) this.table.showRemoteAim({ code, pull: pull / 1000 });
        return { kind: 'shown' };
      }
      case 'place': {
        const match = this.table.match;
        const at = decodePlacement(message);
        if (this.previewing() && match.inHand() !== null && match.placeCueBall(at.x, at.y)) {
          this.table.showBalls();
        }
        return { kind: 'shown' };
      }
      case 'sync':
        // Tables come through restore(), on the session's say.
        return { kind: 'shown' };
    }
  }

  snapshot(): GameMessage | null {
    if (!this.started) return null;
    return syncMessage(this.table.match.current, this.table.match.hash());
  }

  async restore(message: GameMessage, why: RestoreReason): Promise<Restored> {
    if (message.t !== 'sync' || !this.online()) return 'rejected';
    await this.idle();
    const match = this.table.match;
    const own = match.current;
    const ownHash = match.hash();
    // A table must be one of this match, and be the one its fingerprint names.
    const state = stateFromSync(message, own.setup, match.table);
    if (!state || match.hash(state) !== message.h) return 'rejected';
    // The fingerprint leaves out who won the match (a resignation between racks changes nothing
    // else), so that is compared too.
    if (message.h === ownHash && message.match === own.winner) return 'same';
    if (why === 'saved') return this.take(state);
    // The host's table is never behind this one by more than the one action that may have been
    // lost on the way when the connection dropped (play stops while the other player is away).
    if (state.shot < own.shot - 1) return 'rejected';
    if (why === 'rejoin' && this.lastOwn && this.replays(state, this.lastOwn.action, ownHash)) {
      const resend = this.lastOwn.message;
      for (const listener of this.listeners) listener.send(resend, true);
      return 'resent';
    }
    return this.take(state);
  }

  status(): GameStatus {
    if (!this.online()) return 'none';
    return this.table.match.current.winner === null ? 'playing' : 'over';
  }

  async resign(): Promise<void> {
    if (this.status() !== 'playing') return;
    this.table.match.award(other(this.mySeat));
    this.table.showBalls();
  }

  async forfeit(_reason: ForfeitReason): Promise<void> {
    if (this.status() !== 'playing') return;
    this.table.match.award(this.mySeat);
    this.table.showBalls();
  }

  setLagAllowance(ms: number): void {
    this.allowance = Math.max(0, ms);
    const clock = this.clock;
    if (clock && !clock.mine) this.arm(clock.key, clock.mine, clock.since);
  }

  hold(on: boolean): void {
    if (!this.started) return;
    this.held = on;
    this.table.setLocalSeats(on ? [] : [this.mySeat]);
    if (on) this.table.showRemoteAim(null);
    // Away or out of step, nobody's clock runs; it starts afresh when play resumes.
    this.stopClock();
    this.onState();
  }

  // --- the shot clocks, for the interface --------------------------------------------------------

  /**
   * The shot clock of `seat`, while it is that player's turn: seconds used, and seconds allowed
   * (for the other player, with the network's allowance). Null when no clock runs for them.
   */
  clockFor(seat: Seat): { used: number; limit: number } | null {
    const clock = this.clock;
    const limit = this.table.match.current.setup.shotClock;
    if (!clock || limit <= 0 || clock.mine !== (seat === this.mySeat)) return null;
    return {
      used: Math.max(0, (this.now() - clock.since) / 1000),
      limit: clock.mine ? limit : limit + this.allowance / 1000,
    };
  }

  /** The other player's shot clock as this side times it, or null. */
  remoteClock(): { used: number; limit: number } | null {
    return this.clockFor(other(this.mySeat));
  }

  // --- the other player's play -------------------------------------------------------------------

  private async remoteShot(message: ShotMessage): Promise<Receipt> {
    await this.idle();
    const match = this.table.match;
    this.catchUp();
    const state = match.current;
    if (!shotInRange(message)) return violation('sent a shot outside what the cue can do');
    const turn = this.remoteTurn(state, message.n);
    if (turn) return turn;
    const where = match.inHand(state);
    const placed = message.x !== undefined && message.y !== undefined;
    let placement: Placement | null = null;
    if (where !== null) {
      if (!placed) return violation('played the cue ball in hand without placing it');
      placement = { x: message.x!, y: message.y! };
      const at = decodePlacement(placement);
      if (!match.canPlaceCueBall(at.x, at.y)) {
        return violation('placed the cue ball where it may not go');
      }
    } else if (placed) {
      return violation('moved the cue ball when it was not in hand');
    }
    const due = match.needsCall(state);
    if (due && message.pocket === null) return violation('shot at the 8 without calling a pocket');
    if (!due && message.pocket !== null) return violation('called a pocket when none was due');
    const { yaw, pitch, speed, a, b } = message;
    const intent = { pocket: message.pocket as PocketId | null, safety: message.safety };
    this.table.showRemoteAim(null);
    const playing = this.table.shoot({ yaw, pitch, speed, a, b }, intent, placement);
    // The match takes the shot at once; the table plays it out afterwards.
    if (match.current.shot !== state.shot + 1) {
      await playing.catch(() => undefined);
      return violation('sent a shot that cannot be played');
    }
    const hash = match.hash();
    void playing.then(
      (result) => this.table.afterShot(result),
      (error: unknown) => console.error(error),
    );
    return hash === message.h ? { kind: 'played' } : { kind: 'desync', n: message.n };
  }

  private async remoteDecision(n: number, choice: Choice): Promise<Receipt> {
    await this.idle();
    const match = this.table.match;
    const state = match.current;
    const rack = state.rack;
    if (state.winner !== null || rack.phase !== 'decision' || rack.decision === null) {
      return violation('made a choice when none was due');
    }
    if (rack.turn !== other(this.mySeat)) return violation('made a choice that was not theirs');
    if (n !== state.shot) return violation('made a choice out of order');
    if (!CHOICES[rack.decision].includes(choice)) return violation('made a choice not on offer');
    match.decide(choice);
    this.table.showBalls();
    this.table.aimAtRack();
    this.table.say(`${state.setup.names[rack.turn]} ${CHOSE[choice]}`);
    return { kind: 'played' };
  }

  private async remoteTimeout(n: number): Promise<Receipt> {
    await this.idle();
    const match = this.table.match;
    this.catchUp();
    const state = match.current;
    const turn = this.remoteTurn(state, n);
    if (turn) return turn;
    match.timeOut();
    this.table.showBalls();
    this.table.aimAtRack();
    const after = match.current;
    const next = after.setup.names[after.rack.turn];
    // On the break the other player breaks instead; later they take the cue ball in hand.
    const then = after.rack.phase === 'break' ? `${next} breaks` : `${next}: ball in hand`;
    this.table.say(`Time ran out for ${state.setup.names[state.rack.turn]}. ${then}`);
    return { kind: 'played' };
  }

  /** Why it is not the other player's shot `n` now, or null when it is. */
  private remoteTurn(state: MatchState, n: number): Receipt | null {
    const rack = state.rack;
    if (state.winner !== null || (rack.phase !== 'break' && rack.phase !== 'play')) {
      return violation('played when no shot was due');
    }
    if (rack.turn !== other(this.mySeat)) return violation('played out of turn');
    if (n !== state.shot) return violation('played a shot out of order');
    return null;
  }

  /**
   * The other player may have gone on to the next rack before this player has: the next rack is
   * the same for both, so this side goes on too.
   */
  private catchUp(): void {
    const match = this.table.match;
    const state = match.current;
    if (state.rack.phase !== 'over' || state.winner !== null) return;
    match.nextRack();
    this.table.showBalls();
    this.table.aimAtRack();
  }

  /** Whether playing `action` on `state` leads to the table this side has (`hash`). */
  private replays(state: MatchState, action: MatchAction, hash: string): boolean {
    const scratch = new MatchController(state.setup);
    scratch.state.set(state);
    try {
      if (action.kind === 'shot') scratch.shoot(action.code, action.intent, action.placement);
      else if (action.kind === 'decide') scratch.decide(action.choice);
      else scratch.timeOut();
    } catch {
      return false;
    }
    return scratch.hash() === hash;
  }

  private take(state: MatchState): Restored {
    this.table.match.state.set(state);
    this.lastOwn = null;
    this.table.showRemoteAim(null);
    this.table.showBalls();
    this.table.aimAtRack();
    this.table.restored?.();
    return 'restored';
  }

  // --- the local player's play -------------------------------------------------------------------

  private onAction(action: MatchAction): void {
    if (!this.online()) return;
    if (action.kind === 'shot') {
      // The shots play out one after another, each from when this device took it at the soonest.
      const from = Math.max(this.playbackEnd, this.now());
      this.playbackEnd = from + action.duration * 1000 + PLAYBACK_TAIL_MS;
      // The match told of its new state before this: time the turn again, now that the shot's
      // length is known.
      this.stopClock();
      this.onState();
    }
    if (action.seat !== this.mySeat) return;
    let message: GameMessage;
    if (action.kind === 'shot') {
      message = shotMessage(
        action.n,
        action.code,
        action.intent.pocket,
        action.intent.safety,
        action.placement,
        action.hash,
      );
    } else if (action.kind === 'decide') {
      message = { t: 'decide', n: action.n, choice: action.choice };
    } else {
      message = { t: 'timeout', n: action.n };
    }
    this.lastOwn = { action, message };
    this.sentAim = this.sentPlace = '';
    for (const listener of this.listeners) listener.send(message, true);
  }

  /** Sends the local player's cue (or cue ball in hand) if it moved since the last preview. */
  private preview(): void {
    if (!this.online() || this.held || this.table.playing) return;
    const match = this.table.match;
    const state = match.current;
    if (state.winner !== null || state.rack.turn !== this.mySeat) return;
    if (state.rack.phase !== 'break' && state.rack.phase !== 'play') return;
    const cue = state.balls[0]!;
    if (match.inHand(state) !== null) {
      const x = Math.round(cue.rx / 1e-5);
      const y = Math.round(cue.ry / 1e-5);
      const key = `${x},${y}`;
      if (key !== this.sentPlace) {
        this.sentPlace = key;
        this.broadcast({ t: 'place', x, y });
        return;
      }
    }
    const { code, pull } = this.table.localAim();
    const aim = {
      t: 'aim' as const,
      ...code,
      pull: Math.round(Math.min(1, Math.max(0, pull)) * 1000),
    };
    const key = JSON.stringify(aim);
    if (key === this.sentAim) return;
    this.sentAim = key;
    this.broadcast(aim);
  }

  private broadcast(message: GameMessage): void {
    for (const listener of this.listeners) listener.send(message, false);
  }

  // --- the shot clocks ---------------------------------------------------------------------------

  private onState(): void {
    if (!this.online()) return;
    const state = this.table.match.current;
    const rack = state.rack;
    const timed =
      !this.held &&
      state.setup.shotClock > 0 &&
      state.winner === null &&
      (rack.phase === 'break' || rack.phase === 'play');
    if (!timed) {
      if (this.clock) this.stopClock();
      return;
    }
    const key = `${state.rackNumber}:${state.shot}:${rack.turn}:${rack.phase}`;
    if (this.clock?.key === key) return;
    // A new turn: the other player's cue shows again only from their next preview.
    this.table.showRemoteAim(null);
    // The clock starts once the shots so far have played out at normal speed.
    this.arm(key, rack.turn === this.mySeat, Math.max(this.now(), this.playbackEnd));
  }

  private arm(key: string, mine: boolean, since: number): void {
    this.stopClock();
    const limit = this.table.match.current.setup.shotClock * 1000;
    const due = since + limit + (mine ? 0 : this.allowance + STALL_GRACE_MS) - this.now();
    const timer = this.timers.setTimeout(
      () => (mine ? this.expired(key) : this.stalled(key)),
      Math.max(0, due),
    );
    this.clock = { key, mine, since, timer };
  }

  /** This player's clock ran out: time is called here, and the other side is told. */
  private expired(key: string): void {
    if (this.clock?.key !== key || this.held || this.status() !== 'playing') return;
    this.clock = null;
    const match = this.table.match;
    const name = match.current.setup.names[this.mySeat];
    // The match reports the time-out, which goes to the other player as this player's own.
    match.timeOut();
    this.table.showBalls();
    this.table.aimAtRack();
    const after = match.current;
    const next = after.setup.names[after.rack.turn];
    const then = after.rack.phase === 'break' ? `${next} breaks` : `${next}: ball in hand`;
    this.table.say(`Time ran out for ${name}. ${then}`);
  }

  private stalled(key: string): void {
    if (this.clock?.key !== key || this.held || this.status() !== 'playing') return;
    this.clock = null;
    for (const listener of this.listeners) {
      listener.violation('stalled', 'let its shot clock run out without saying so');
    }
  }

  private stopClock(): void {
    if (this.clock) this.timers.clearTimeout(this.clock.timer);
    this.clock = null;
  }

  // --- helpers ---------------------------------------------------------------------------------

  private online(): boolean {
    return this.started && this.table.match.current.setup.mode === 'online';
  }

  /** Whether a preview from the other player may show now. */
  private previewing(): boolean {
    const state = this.table.match.current;
    return (
      !this.held &&
      !this.table.playing &&
      state.winner === null &&
      state.rack.turn !== this.mySeat &&
      (state.rack.phase === 'break' || state.rack.phase === 'play')
    );
  }

  /** Waits until no shot is playing out on the screen. */
  private async idle(): Promise<void> {
    while (this.table.playing) {
      await new Promise<void>((resolve) => this.timers.setTimeout(resolve, 40));
    }
  }
}

function violation(detail: string): Receipt {
  return { kind: 'violation', detail };
}

export type { SyncMessage };
