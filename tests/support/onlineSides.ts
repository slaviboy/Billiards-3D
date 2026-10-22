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

// One player's device for online tests: the real match, a stand-in for the table on the screen
// (shots play out at once), the port that connects it to a session, and timers the test runs by
// hand. Helpers play the local player's shots as the interface would.

import { PoolPort, type CueAim, type PortTable } from '../../src/game/GamePort.ts';
import { POOL_CODEC, type GameMessage, type PoolTerms } from '../../src/game/gameMessages.ts';
import {
  MatchController,
  type MatchSetup,
  type ShotResult,
} from '../../src/game/MatchController.ts';
import {
  encodePlacement,
  encodeShot,
  type Placement,
  type ShotCode,
} from '../../src/game/shotCodec.ts';
import type { LinkPort } from '../../src/net/LinkPort.ts';
import {
  OnlineSession,
  type SavedSession,
  type SessionStorage,
  type Timers,
} from '../../src/net/OnlineSession.ts';
import { createInvite } from '../../src/net/protocol.ts';
import type { PocketId } from '../../src/physics/types.ts';
import type { Intent, Seat } from '../../src/rules/types.ts';

export const invite = createInvite();
export const BUILD = 'test-build';

/** Timers that run only when the test says time has passed. */
export class ManualTimers implements Timers {
  private clock = 0;
  private next = 1;
  private readonly pending = new Map<number, { at: number; every: number; run: () => void }>();

  get time(): number {
    return this.clock;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.next++;
    this.pending.set(id, { at: this.clock + ms, every: 0, run: callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  setInterval(callback: () => void, ms: number): unknown {
    const id = this.next++;
    this.pending.set(id, { at: this.clock + ms, every: ms, run: callback });
    return id;
  }

  clearInterval(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  advance(ms: number): void {
    const end = this.clock + ms;
    for (;;) {
      const due = [...this.pending.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, timer] = due;
      this.clock = timer.at;
      if (timer.every > 0) timer.at += timer.every;
      else this.pending.delete(id);
      timer.run();
    }
    this.clock = end;
  }
}

export class MemoryStorage implements SessionStorage<GameMessage, PoolTerms> {
  saved: SavedSession<GameMessage, PoolTerms> | null = null;
  save(session: SavedSession<GameMessage, PoolTerms>): void {
    this.saved = JSON.parse(JSON.stringify(session));
  }
  clear(): void {
    this.saved = null;
  }
}

/** The table on the screen, without a screen: shots play out at once. */
export class FakeTable implements PortTable {
  readonly match = new MatchController({
    mode: 'practice',
    size: '9ft',
    race: 1,
    shotClock: 0,
    names: ['Player 1', 'Player 2'],
    seed: 'welcome',
    firstBreak: 0,
  });
  playing = false;
  localSeats: readonly Seat[] = [0, 1];
  aim: CueAim = { code: encodeShot(Math.PI / 2, 2, 2, 0, 0), pull: 0 };
  remoteAim: CueAim | null = null;
  readonly notes: string[] = [];
  readonly afterShots: ShotResult[] = [];
  readonly matches: MatchSetup[] = [];

  async newMatch(setup: MatchSetup, localSeats: readonly Seat[]): Promise<void> {
    this.matches.push(setup);
    this.match.start(setup);
    this.localSeats = localSeats;
  }

  setLocalSeats(seats: readonly Seat[]): void {
    this.localSeats = seats;
  }

  async shoot(code: ShotCode, intent: Intent, placement: Placement | null): Promise<ShotResult> {
    return this.match.shoot(code, intent, placement);
  }

  afterShot(result: ShotResult): void {
    this.afterShots.push(result);
  }

  showBalls(): void {}

  aimAtRack(): void {}

  localAim(): CueAim {
    return this.aim;
  }

  showRemoteAim(aim: CueAim | null): void {
    this.remoteAim = aim;
  }

  say(text: string): void {
    this.notes.push(text);
  }

  /** Whether the player at this device may shoot now, as the interface would allow. */
  canAct(): boolean {
    const s = this.match.current;
    return (
      s.winner === null &&
      (s.rack.phase === 'break' || s.rack.phase === 'play') &&
      this.localSeats.includes(s.rack.turn)
    );
  }
}

/** A hard break straight at the apex, or a soft shot at `heading` once the rack is in play. */
export function shotFor(match: MatchController, heading?: number): ShotCode {
  const cue = match.current.balls[0]!;
  if (heading === undefined && match.current.rack.phase === 'break') {
    const to = match.table.footSpot;
    return encodeShot(Math.atan2(to.y - cue.ry, to.x - cue.rx), 0, 7, 0, -0.1);
  }
  return encodeShot(heading ?? 1.9, 2, 1.6, 0.05, 0);
}

export function device() {
  const timers = new ManualTimers();
  const table = new FakeTable();
  const port = new PoolPort(table, { timers, now: () => timers.time });
  return {
    table,
    port,
    timers,
    now: () => timers.time,
    storage: new MemoryStorage(),
    match: table.match,
    /**
     * Plays the local player's shot as the interface would: the cue ball where it lies when it is
     * in hand, the first pocket called when the 8 is due. Throws if it is not their turn.
     */
    shoot(code?: ShotCode, pocket: PocketId = 0, placement?: Placement) {
      if (!table.canAct()) throw new Error('not this player’s turn');
      const match = table.match;
      const cue = match.current.balls[0]!;
      const place = match.inHand() ? (placement ?? encodePlacement(cue.rx, cue.ry)) : null;
      const intent = { pocket: match.needsCall() ? pocket : null, safety: false };
      return match.shoot(code ?? shotFor(match), intent, place);
    },
  };
}

export type Device = ReturnType<typeof device>;

export const terms = (friend: string, over: Partial<PoolTerms> = {}): PoolTerms => ({
  seed: '0123456789abcdef',
  race: 3,
  shotClock: 0,
  size: '9ft',
  names: ['Ana', friend],
  host: 0,
  firstBreak: 0,
  ...over,
});

/** The session options every test shares. */
export function sessionOptions(d: Device, link: LinkPort, name: string) {
  return {
    link,
    port: d.port,
    codec: POOL_CODEC,
    invite,
    name,
    build: BUILD,
    timers: d.timers,
    now: d.now,
    storage: d.storage,
  };
}

export function hostSession(d: Device, link: LinkPort, over: Partial<PoolTerms> = {}) {
  return OnlineSession.host({
    ...sessionOptions(d, link, 'Ana'),
    terms: (friend) => terms(friend, over),
  });
}

export function guestSession(d: Device, link: LinkPort, name = 'Ben') {
  return OnlineSession.join(sessionOptions(d, link, name));
}
