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

// Calling the pocket for the 8: a marker over each pocket, following the camera; a tap calls it,
// the called one shows the 8.

import type { PocketId } from '../../physics/types.ts';
import type { PocketShape } from '../../table/geometry.ts';
import { el } from '../Dialog.ts';
import { EIGHT_BALL } from '../icons.ts';

export interface PocketPickerHandlers {
  pockets(): readonly PocketShape[];
  /** The table's size, to name the pockets. */
  size(): { W: number; L: number };
  called(): PocketId | null;
  call(pocket: PocketId): void;
  toClient(x: number, y: number): { x: number; y: number; visible: boolean };
}

/** A pocket's name as a player would say it: the foot right corner, the left side pocket... */
export function pocketName(pocket: PocketShape, size: { W: number; L: number }): string {
  const side = pocket.center.x < size.W / 2 ? 'left' : 'right';
  if (!pocket.corner) return `${side} side pocket`;
  return `${pocket.center.y < size.L / 2 ? 'head' : 'foot'} ${side} corner pocket`;
}

export class PocketPicker {
  readonly element: HTMLElement;
  private readonly marks = new Map<PocketId, HTMLButtonElement>();
  private shown = false;

  constructor(private readonly handlers: PocketPickerHandlers) {
    this.element = el('div', 'pocket-picker');
    this.element.hidden = true;
  }

  private build(): void {
    this.element.replaceChildren();
    this.marks.clear();
    const size = this.handlers.size();
    for (const pocket of this.handlers.pockets()) {
      const mark = el('button', 'pocket-mark');
      mark.type = 'button';
      mark.dataset.pocket = String(pocket.id);
      mark.setAttribute('aria-label', `Call the ${pocketName(pocket, size)} for the 8`);
      mark.innerHTML = `<span class="pocket-eight">${EIGHT_BALL}</span>`;
      mark.addEventListener('click', () => {
        this.handlers.call(pocket.id);
        this.render(true);
      });
      this.marks.set(pocket.id, mark);
      this.element.append(mark);
    }
  }

  /** Shows the markers or hides them; while shown, keeps them over the pockets. */
  render(show: boolean): void {
    this.shown = show;
    this.element.hidden = !show;
    if (!show) return;
    const pockets = this.handlers.pockets();
    if (this.marks.size !== pockets.length || pockets.some((p) => !this.marks.has(p.id))) {
      this.build();
    }
    const called = this.handlers.called();
    for (const pocket of pockets) {
      const mark = this.marks.get(pocket.id)!;
      const at = this.handlers.toClient(pocket.center.x, pocket.center.y);
      mark.style.transform = `translate(${at.x}px, ${at.y}px)`;
      mark.hidden = !at.visible;
      const on = called === pocket.id;
      mark.classList.toggle('called', on);
      mark.setAttribute('aria-pressed', String(on));
    }
  }

  /** Per frame while shown: follows the camera. */
  follow(): void {
    if (this.shown) this.render(true);
  }
}
