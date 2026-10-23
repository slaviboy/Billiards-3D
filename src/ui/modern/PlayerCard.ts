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

// A player's card: the initial in a ring that runs down with the shot clock, with the player's
// group as a ball on its corner; the name; the racks won; and the group's balls, pictured as the
// table's own, those pocketed bright and those still on the table faint, with the 8 at the end,
// ringed once it is the player's to shoot. It glows while it is the player's turn. It is small, in
// the top bar, with a camera's picture inside the round avatar (in a call on a phone held upright
// the avatar grows to a 4:3 window the picture fills, the clock running round its edge, the name
// and the balls over its foot); or large, on its own beside the table (in a row on a phone held
// upright), with the picture across its top like a call's, the group and its count under the
// name, the race to win as pips under the racks, and the balls in a rail like a table's ball
// return.

import type { Group, Seat } from '../../rules/types.ts';
import { ballImage } from '../ballPreview.ts';
import { el } from '../Dialog.ts';

export interface PlayerView {
  readonly name: string;
  readonly score: number;
  /** The racks that win the match. */
  readonly race: number;
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
const GROUP_BALLS: Record<1 | 2, readonly number[]> = {
  1: [1, 2, 3, 4, 5, 6, 7],
  2: [9, 10, 11, 12, 13, 14, 15],
};
const GROUP_NAME = { 1: 'Solids', 2: 'Stripes' } as const;

export class PlayerCard {
  readonly element: HTMLElement;
  private readonly name: HTMLElement;
  private readonly tag: HTMLElement;
  private readonly score: HTMLElement;
  private readonly racks: HTMLElement;
  private readonly pips: HTMLElement;
  private readonly balls: HTMLElement;
  private readonly avatar: HTMLElement;
  private readonly initial: HTMLElement;
  private readonly badge: HTMLImageElement;
  private readonly ring: SVGCircleElement;
  private last = '';
  private video: HTMLVideoElement | null = null;
  private large = false;

  constructor(seat: Seat) {
    this.element = el('div', `m-card player-card seat-${seat}`);
    this.element.dataset.testid = `player-${seat}`;
    const avatar = (this.avatar = el('div', 'player-avatar'));
    avatar.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="ring-track" cx="24" cy="24" r="21"/><circle class="ring-time" cx="24" cy="24" r="21" stroke-dasharray="${RING}" stroke-dashoffset="0"/></svg>`;
    this.ring = avatar.querySelector('.ring-time')!;
    this.initial = el('span', 'player-initial');
    this.badge = el('img', 'player-badge');
    this.badge.alt = '';
    this.badge.hidden = true;
    avatar.append(this.initial, this.badge);
    const text = el('div', 'player-text');
    this.name = el('div', 'player-name');
    this.tag = el('div', 'player-tag');
    this.balls = el('div', 'player-balls');
    text.append(this.name, this.tag, this.balls);
    this.score = el('div', 'player-score');
    this.racks = el('span', 'player-racks');
    this.pips = el('span', 'player-pips');
    this.pips.setAttribute('aria-hidden', 'true');
    this.score.append(this.racks, this.pips);
    this.element.append(avatar, text, this.score);
  }

  /**
   * Online: the player's camera (inside the avatar, round so the top bar keeps its height, or a 4:3
   * window on a phone held upright, the bar growing for it; or across the top of a large card), and
   * the microphone, camera and speaker switches beside the score.
   */
  attachMedia(video: HTMLVideoElement, controls: HTMLElement): void {
    this.video = video;
    this.score.before(controls);
    this.placeVideo();
  }

  /** Large, on its own beside the table, or small, in the top bar (the layout is in pool.css). */
  setLarge(on: boolean): void {
    this.large = on;
    this.element.classList.toggle('large', on);
    this.placeVideo();
  }

  private placeVideo(): void {
    const video = this.video;
    const home = this.large ? this.element : this.avatar;
    if (!video || video.parentElement === home) return;
    home.prepend(video);
    // A video moved in the page may stop (Safari); a live picture carries on.
    if (video.srcObject) void video.play().catch(() => undefined);
  }

  /** Whether a picture shows in the avatar. */
  setVideo(on: boolean): void {
    this.element.classList.toggle('video-on', on);
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
    // Where the avatar is a call's window, the clock runs round its edge (pool.css).
    this.avatar.style.setProperty(
      '--clock',
      view.clock === null || !view.active ? '0' : String(view.clock),
    );
    const key = [
      view.name,
      view.score,
      view.race,
      view.group,
      view.note,
      view.onTable.join(''),
    ].join('|');
    if (key === this.last) return;
    this.last = key;
    this.name.textContent = view.name;
    this.initial.textContent = view.name.trim().charAt(0).toUpperCase() || '?';
    this.racks.textContent = String(view.score);
    this.pips.innerHTML = Array.from(
      { length: view.race },
      (_, i) => `<span class="pip${i < view.score ? ' won' : ''}"></span>`,
    ).join('');
    this.score.title = `${view.score} of ${view.race} ${view.race === 1 ? 'rack' : 'racks'}`;

    const group = view.note === null && view.group !== 0 ? view.group : null;
    const numbers = group ? GROUP_BALLS[group] : [];
    const potted = numbers.filter((n) => !view.onTable[n]).length;
    const cleared = group !== null && potted === numbers.length;
    const tag = group ? (cleared ? 'On the 8' : `${GROUP_NAME[group]} ${potted}/7`) : view.note;
    this.tag.textContent = tag ?? '';
    this.tag.hidden = !tag;
    this.element.setAttribute(
      'aria-label',
      `${view.name}, ${view.score} ${view.score === 1 ? 'rack' : 'racks'}${tag ? `, ${tag}` : ''}${view.active ? ', to shoot' : ''}`,
    );

    this.badge.hidden = group === null;
    if (group) {
      this.badge.src = ballImage(cleared ? 8 : group === 1 ? 1 : 9);
      this.badge.title = cleared ? 'On the 8' : GROUP_NAME[group];
    }

    this.balls.classList.toggle('note', group === null);
    if (group === null) {
      this.balls.textContent = view.note ?? '';
      return;
    }
    const ball = (n: number) => {
      const state = !view.onTable[n] ? ' potted' : n === 8 && cleared ? ' target' : '';
      return `<img class="ball-glyph${state}" src="${ballImage(n)}" alt="" title="${n}">`;
    };
    this.balls.innerHTML = [...numbers, 8].map(ball).join('');
  }
}
