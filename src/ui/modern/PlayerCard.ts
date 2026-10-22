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

// A player's card at the top of the screen: the initial in a ring that runs down with the shot
// clock, the name, the racks won, and the player's group as a row of balls, the pocketed ones
// faded, with the 8 at the end once it is the player's to shoot. It glows while it is the player's
// turn.

import { BALL_COLORS, isStripe } from '../../balls/markings.ts';
import type { Group, Seat } from '../../rules/types.ts';
import { el } from '../Dialog.ts';
import { ballGlyph } from '../icons.ts';

export interface PlayerView {
  readonly name: string;
  readonly score: number;
  readonly group: Group;
  /** Which balls are on the table (index = number). */
  readonly onTable: readonly boolean[];
  readonly active: boolean;
  /** Shown while the table is open, or in practice, instead of the balls. */
  readonly note: string | null;
  /** The shot clock: the part of the time left (0–1), or null without a clock. */
  readonly clock: number | null;
  /** Seconds left on the shot clock, for the warning near the end. */
  readonly seconds: number | null;
}

const RING = 2 * Math.PI * 21;

export class PlayerCard {
  readonly element: HTMLElement;
  private readonly name: HTMLElement;
  private readonly score: HTMLElement;
  private readonly balls: HTMLElement;
  private readonly initial: HTMLElement;
  private readonly ring: SVGCircleElement;
  private last = '';

  constructor(seat: Seat) {
    this.element = el('div', `m-card player-card seat-${seat}`);
    this.element.dataset.testid = `player-${seat}`;
    const avatar = el('div', 'player-avatar');
    avatar.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="ring-track" cx="24" cy="24" r="21"/><circle class="ring-time" cx="24" cy="24" r="21" stroke-dasharray="${RING}" stroke-dashoffset="0"/></svg>`;
    this.ring = avatar.querySelector('.ring-time')!;
    this.initial = el('span', 'player-initial');
    avatar.append(this.initial);
    const text = el('div', 'player-text');
    this.name = el('div', 'player-name');
    this.balls = el('div', 'player-balls');
    text.append(this.name, this.balls);
    this.score = el('div', 'player-score');
    this.element.append(avatar, text, this.score);
  }

  render(view: PlayerView): void {
    this.element.classList.toggle('active', view.active);
    this.element.classList.toggle(
      'hurry',
      view.active && view.seconds !== null && view.seconds <= 10,
    );
    if (view.clock === null || !view.active) {
      this.ring.style.strokeDashoffset = '0';
      this.ring.classList.toggle('off', true);
    } else {
      this.ring.classList.toggle('off', false);
      this.ring.style.strokeDashoffset = String(RING * (1 - view.clock));
    }
    const key = [view.name, view.score, view.group, view.note, view.onTable.join('')].join('|');
    if (key === this.last) return;
    this.last = key;
    this.name.textContent = view.name;
    this.initial.textContent = view.name.trim().charAt(0).toUpperCase() || '?';
    this.score.textContent = String(view.score);
    this.element.setAttribute(
      'aria-label',
      `${view.name}, ${view.score} ${view.score === 1 ? 'rack' : 'racks'}${view.active ? ', to shoot' : ''}`,
    );
    if (view.note !== null || view.group === 0) {
      this.balls.textContent = view.note ?? '';
      return;
    }
    const numbers = view.group === 1 ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
    const cleared = numbers.every((n) => !view.onTable[n]);
    const glyph = (n: number, gone: boolean) =>
      `<span class="ball-glyph${gone ? ' gone' : ''}" title="${n}">${ballGlyph(BALL_COLORS[n]!, isStripe(n), 16)}</span>`;
    this.balls.innerHTML =
      numbers.map((n) => glyph(n, !view.onTable[n])).join('') +
      (cleared ? glyph(8, !view.onTable[8]) : '');
  }
}
