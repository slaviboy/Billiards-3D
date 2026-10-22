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

// The game's dialogs: the main menu, a new match's terms, the settings, the pause menu, the
// choices the break can leave, the end of a rack or match, the controls and the rules.

import type { Store } from '../core/Store.ts';
import { CONTROLS_HELP } from '../input/shortcuts.ts';
import type { Choice, DecisionKind, Seat } from '../rules/types.ts';
import { CLOTHS, type ClothName } from '../scene/surfaces.ts';
import { TABLE_SIZES, type TableSize } from '../table/spec.ts';
import {
  RACES,
  SHOT_CLOCKS,
  SPEEDS,
  type GuideLength,
  type QualitySetting,
  type Settings,
} from '../app/Settings.ts';
import { el, openDialog } from './Dialog.ts';
import { EIGHT_BALL, LINE_ICONS } from './icons.ts';
import { segmented, switchRow } from './modern/controls.ts';

function button(text: string, onClick: () => void, className = 'btn'): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function group(title: string, ...children: HTMLElement[]): HTMLElement {
  const box = el('div', 'settings-group');
  box.append(el('div', 'm-heading', title), ...children);
  return box;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const row = el('label', 'field');
  row.append(el('span', '', label), control);
  return row;
}

function textInput(value: string, label: string): HTMLInputElement {
  const input = el('input');
  input.type = 'text';
  input.value = value;
  input.maxLength = 24;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', label);
  return input;
}

export type MenuChoice = 'practice' | 'local' | 'settings' | 'controls' | 'rules' | 'close';

/** The main menu, over the table. */
export function mainMenu(): Promise<MenuChoice> {
  return openDialog<MenuChoice>('Pool', 'close', ({ body, root, close }) => {
    root.classList.add('main-menu');
    const brand = el('div', 'brand');
    brand.innerHTML = `<span class="brand-ball">${EIGHT_BALL}</span><span><strong>Pool</strong><small>8-ball, by the World Standardized Rules</small></span>`;
    const modes = el('div', 'mode-list');
    const mode = (icon: string, title: string, detail: string, value: MenuChoice) => {
      const b = el('button', 'mode-card');
      b.type = 'button';
      b.dataset.mode = value;
      b.innerHTML = `<span class="mode-icon">${icon}</span><span class="mode-text"><strong>${title}</strong><small>${detail}</small></span>${LINE_ICONS.chevronRight}`;
      b.addEventListener('click', () => close(value));
      return b;
    };
    modes.append(
      mode(LINE_ICONS.target, 'Practice', 'Free play on your own: no rules, no turns', 'practice'),
      mode(
        LINE_ICONS.users,
        'Two players',
        'A match of 8-ball on this device, taking turns',
        'local',
      ),
    );
    const links = el('div', 'menu-links');
    links.append(
      button('Settings', () => close('settings')),
      button('Keyboard and mouse', () => close('controls')),
      button('Rules', () => close('rules')),
    );
    body.append(brand, modes, links);
  });
}

export interface NewMatch {
  readonly names: readonly [string, string];
  readonly size: TableSize;
  readonly race: number;
  readonly shotClock: number;
  /** Who breaks the first rack; 'toss' for a coin toss. */
  readonly firstBreak: Seat | 'toss';
}

/** The terms of a new match for two players on this device; null when cancelled. */
export function newMatchDialog(settings: Settings): Promise<NewMatch | null> {
  return openDialog<NewMatch | null>('Two players', null, ({ body, close }) => {
    const name1 = textInput(settings.name, 'First player');
    const name2 = textInput(settings.name2, 'Second player');
    const names = el('div', 'name-pair');
    names.append(field('First player', name1), field('Second player', name2));
    let size = settings.table;
    let race = String(settings.race);
    let clock = String(settings.shotClock);
    let breaker: '0' | '1' | 'toss' = 'toss';
    const sizes = segmented(
      'Table',
      TABLE_SIZES.map((s) => [s, s === '9ft' ? '9 ft' : '7 ft'] as const),
      size,
      (v) => (size = v),
    );
    const races = segmented(
      'Race to',
      RACES.map((r) => [String(r), String(r)] as const),
      race,
      (v) => (race = v),
    );
    const clocks = segmented(
      'Shot clock',
      SHOT_CLOCKS.map((c) => [String(c), c === 0 ? 'Off' : `${c} s`] as const),
      clock,
      (v) => (clock = v),
    );
    const breakers = segmented(
      'First break',
      [
        ['toss', 'Coin toss'],
        ['0', 'First player'],
        ['1', 'Second player'],
      ] as const,
      breaker,
      (v) => (breaker = v),
    );
    body.append(
      names,
      field('Table', sizes.element),
      field('Race to (racks to win)', races.element),
      field('Shot clock', clocks.element),
      field('First break', breakers.element),
    );
    const actions = el('div', 'dialog-actions');
    actions.append(
      button('Start', () =>
        close({
          names: [name1.value.trim() || 'Player 1', name2.value.trim() || 'Player 2'],
          size,
          race: Number(race),
          shotClock: Number(clock),
          firstBreak: breaker === 'toss' ? 'toss' : breaker === '0' ? 0 : 1,
        }),
      ),
      button('Cancel', () => close(null)),
    );
    body.append(actions);
  });
}

/** The settings, applied as they change. */
export function settingsDialog(store: Store<Settings>): Promise<void> {
  return openDialog<void>('Settings', undefined, ({ body }) => {
    const s = store.get();
    const set = (patch: Partial<Settings>) => store.update(patch);
    const view = segmented(
      'Camera',
      [
        ['3d', '3D'],
        ['top', 'Top'],
      ] as const,
      s.view,
      (v) => set({ view: v }),
    );
    const guide = segmented<GuideLength>(
      'Aiming guide',
      [
        ['long', 'Long'],
        ['short', 'Short'],
        ['off', 'Off'],
      ],
      s.guide,
      (v) => set({ guide: v }),
    );
    const speed = segmented(
      'Shot playback',
      SPEEDS.map((x) => [String(x), `${x}×`] as const),
      String(s.speed),
      (v) => set({ speed: Number(v) }),
    );
    const cloth = segmented<ClothName>(
      'Cloth',
      (Object.keys(CLOTHS) as ClothName[]).map(
        (c) =>
          [c, { blueGreen: 'Tournament', yellowGreen: 'Green', electricBlue: 'Blue' }[c]] as const,
      ),
      s.cloth,
      (v) => set({ cloth: v }),
    );
    const quality = segmented<QualitySetting>(
      'Graphics',
      [
        ['auto', 'Auto'],
        ['high', 'High'],
        ['low', 'Low'],
      ],
      s.quality,
      (v) => set({ quality: v }),
    );
    const [sound] = switchRow('Sound', s.sound, (on) => set({ sound: on }));
    const volume = el('input', 'volume');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '100';
    volume.value = String(Math.round(s.volume * 100));
    volume.setAttribute('aria-label', 'Volume');
    volume.addEventListener('input', () => set({ volume: Number(volume.value) / 100 }));
    const [left] = switchRow('Controls on the left', s.leftHanded, (on) => set({ leftHanded: on }));
    const name = textInput(s.name, 'Your name');
    name.addEventListener('change', () => set({ name: name.value.trim() || s.name }));
    body.append(
      group(
        'Table',
        field('Camera', view.element),
        field('Aiming guide', guide.element),
        field('Shot playback', speed.element),
        field('Cloth', cloth.element),
      ),
      group('Sound', sound, field('Volume', volume)),
      group(
        'Screen',
        left,
        field('Graphics (takes effect when the page reloads)', quality.element),
      ),
      group('You', field('Name', name)),
    );
  });
}

export type PauseChoice =
  'resume' | 'newGame' | 'settings' | 'controls' | 'rules' | 'concede' | 'menu';

export function pauseMenu(options: { readonly canConcede: boolean }): Promise<PauseChoice> {
  return openDialog<PauseChoice>('Paused', 'resume', ({ body, root, close }) => {
    root.classList.add('pause-menu');
    const list = el('div', 'pause-list');
    const item = (icon: string, text: string, value: PauseChoice, className = '') => {
      const b = el('button', `pause-item ${className}`.trim());
      b.type = 'button';
      b.dataset.choice = value;
      b.innerHTML = `${icon}<span>${text}</span>`;
      b.addEventListener('click', () => close(value));
      return b;
    };
    list.append(
      item(LINE_ICONS.next, 'Resume', 'resume', 'primary'),
      item(LINE_ICONS.restart, 'New game', 'newGame'),
      item(LINE_ICONS.sliders, 'Settings', 'settings'),
      item(LINE_ICONS.target, 'Keyboard and mouse', 'controls'),
      item(LINE_ICONS.book, 'Rules', 'rules'),
    );
    if (options.canConcede) list.append(item(LINE_ICONS.flag, 'Concede the rack', 'concede'));
    list.append(item(LINE_ICONS.exit, 'Main menu', 'menu'));
    body.append(list);
  });
}

const DECISIONS: Record<
  DecisionKind,
  { title: string; detail: string; labels: Partial<Record<Choice, string>> }
> = {
  illegalBreak: {
    title: 'Illegal break',
    detail: 'The break did not pocket a ball or drive four balls to a rail.',
    labels: {
      accept: 'Play the table as it lies',
      rerack: 'Re-rack and break',
      rerackOther: 'Re-rack; the breaker breaks again',
    },
  },
  eightOnBreak: {
    title: 'The 8 on the break',
    detail: 'The 8 went down on a legal break.',
    labels: { spot: 'Spot the 8 and play on', rebreak: 'Re-rack and break again' },
  },
  eightOnFoulBreak: {
    title: 'The 8 on a foul break',
    detail: 'The 8 went down and the break was a foul.',
    labels: {
      spot: 'Spot the 8; cue ball in hand behind the head string',
      rebreak: 'Re-rack and break',
    },
  },
};

/** A choice the break left to a player. Escape or a stray tap does not decide for them. */
export async function decisionDialog(
  kind: DecisionKind,
  chooser: string,
  choices: readonly Choice[],
): Promise<Choice> {
  const d = DECISIONS[kind];
  for (;;) {
    const answer = await openDialog<Choice | null>(
      d.title,
      null,
      ({ body, close }) => {
        body.append(el('p', '', d.detail), el('p', 'dialog-lead', `${chooser}, your choice:`));
        const list = el('div', 'choice-list');
        for (const choice of choices) {
          const b = button(d.labels[choice] ?? choice, () => close(choice));
          b.dataset.choice = choice;
          list.append(b);
        }
        body.append(list);
      },
      { backdropCloses: false },
    );
    if (answer !== null) return answer;
  }
}

export type ResultChoice = 'next' | 'rematch' | 'menu' | 'look';

/** The end of a rack, or of the match. */
export function resultDialog(options: {
  readonly title: string;
  readonly detail: string;
  readonly names: readonly [string, string];
  readonly score: readonly [number, number];
  readonly matchOver: boolean;
}): Promise<ResultChoice> {
  return openDialog<ResultChoice>(
    options.title,
    'look',
    ({ body, root, close }) => {
      root.classList.add('result-dialog');
      if (options.matchOver) {
        const trophy = el('div', 'result-trophy');
        trophy.innerHTML = LINE_ICONS.trophy;
        body.append(trophy);
      }
      body.append(el('p', 'result-detail', options.detail));
      const score = el('div', 'result-score');
      score.innerHTML = `<span>${escapeHtml(options.names[0])}</span><strong>${options.score[0]}</strong><em>–</em><strong>${options.score[1]}</strong><span>${escapeHtml(options.names[1])}</span>`;
      body.append(score);
      const actions = el('div', 'dialog-actions');
      if (options.matchOver) {
        actions.append(
          button('Rematch', () => close('rematch')),
          button('Main menu', () => close('menu')),
        );
      } else {
        actions.append(
          button('Next rack', () => close('next')),
          button('Look at the table', () => close('look')),
        );
      }
      body.append(actions);
    },
    { backdropCloses: false },
  );
}

/** Every key and mouse control. */
export function controlsDialog(): Promise<void> {
  return openDialog<void>('Keyboard and mouse', undefined, ({ body }) => {
    for (const section of CONTROLS_HELP) {
      const table = el('table', 'shortcuts');
      for (const [keys, action] of section.rows) {
        const tr = el('tr');
        tr.append(el('td', '', keys), el('td', '', action));
        table.append(tr);
      }
      body.append(group(section.title, table));
    }
  });
}

/** The rules in brief. */
export function rulesDialog(): Promise<void> {
  return openDialog<void>('8-ball rules', undefined, ({ body, root }) => {
    root.classList.add('rules-dialog');
    body.innerHTML = `
      <p>Played by the World Standardized Rules, in brief:</p>
      <ul>
        <li><strong>The break.</strong> Break from behind the head string. A legal break pockets a ball or
          drives at least four balls to a rail; otherwise the other player chooses how play goes on.</li>
        <li><strong>Groups.</strong> The table is open after the break. Pocketing a ball of one group
          (solids 1–7 or stripes 9–15) on a legal shot gives that group to the shooter.</li>
        <li><strong>A legal shot.</strong> Hit a ball of your group first (on an open table, anything but
          the 8), then pocket a ball or drive any ball to a rail.</li>
        <li><strong>Fouls</strong> give the other player the cue ball in hand anywhere: a scratch, hitting
          the wrong ball first, no rail after contact, or the shot clock running out.</li>
        <li><strong>The 8.</strong> Once your group is cleared, call a pocket for the 8 and sink it there
          to win the rack. Pocketing it early, in another pocket, or with a foul loses the rack.</li>
        <li><strong>Safety.</strong> Call a safety before the shot to give up the table after it, whatever
          goes in.</li>
      </ul>
      <p class="fine">Only the 8's pocket is called; the other balls need no call. Balls cannot leave the
        table or jump.</p>`;
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
