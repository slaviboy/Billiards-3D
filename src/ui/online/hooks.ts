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

// What the interface asks of online play (src/ui/online/OnlinePlay.ts), at the few points where a
// match against a friend online goes differently from one on this device.

import type { Seat } from '../../rules/types.ts';

export interface OnlineHooks {
  /** An online game is open: connected, or waiting for the friend; not closed. */
  readonly active: boolean;
  /** The seat this device plays in the online match on the table, or null. */
  readonly seat: Seat | null;
  /**
   * Before the main menu opens: an invitation in the address bar, or a game this tab was playing,
   * comes first. Resolves true when it took over (the menu is not needed).
   */
  intercept(): Promise<boolean>;
  /** The main menu's "Play a friend online"; true once a game is set up. */
  host(): Promise<boolean>;
  /** The main menu's "Join a game"; true once a game is set up. */
  join(): Promise<boolean>;
  /** After the match: a rematch with the same player, the other one breaking first. */
  rematch(): Promise<void>;
  /** The pause menu's Resign: gives up the match, staying connected for a rematch. */
  resign(): Promise<void>;
  /** The pause menu's Leave: resigns a match in progress, leaves and opens the main menu. */
  leave(): Promise<void>;
  /** Before another match replaces the online one: asks, and leaves; false to stay. */
  leaveForNewMatch(): Promise<boolean>;
  /**
   * Online, the shot clocks are kept by the game's port: `seat`'s clock while it is their turn
   * (seconds used and allowed, the other player's with the network's allowance), or null.
   */
  clockFor(seat: Seat): { readonly used: number; readonly limit: number } | null;
}
