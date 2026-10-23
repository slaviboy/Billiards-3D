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

// The player's preferences, kept in this browser. Whatever is stored is checked field by field
// against the defaults, so a damaged or older entry never breaks the game; storage that is blocked
// simply means the defaults. A tablet or a computer starts with large cards and the menu bar, a
// phone with small cards in the top bar and the menu behind its button, which leave its small
// screen to the table.

import { CLOTHS, type ClothName } from '../scene/surfaces.ts';
import type { ViewMode } from '../scene/CameraRig.ts';
import { isTableSize, type TableSize } from '../table/spec.ts';

export type GuideLength = 'long' | 'short' | 'off';
export type QualitySetting = 'auto' | 'high' | 'low';

export interface Settings {
  readonly view: ViewMode;
  readonly guide: GuideLength;
  /** Playback speed of shots. */
  readonly speed: number;
  readonly sound: boolean;
  /** 0–1. */
  readonly volume: number;
  readonly quality: QualitySetting;
  readonly cloth: ClothName;
  /** Controls on the left edge instead of the right. */
  readonly leftHanded: boolean;
  /** Turning the view keeps its zoom, instead of refitting the table to the screen at each angle. */
  readonly keepZoom: boolean;
  /**
   * The players' cards large, with room for a video call: beside the table, or in a row under the
   * buttons on a phone held upright. Otherwise they are small, in the top bar.
   */
  readonly largeCards: boolean;
  /** The menus along the top bar, as in a desktop program, instead of behind the menu button. */
  readonly menuBar: boolean;
  /** A tip under the pointer, naming a control and how to use it, while hovering over it (off
   * unless chosen: the (i) guide shows the same). */
  readonly hints: boolean;
  /** The player's name (for two players on one device, the second name too). */
  readonly name: string;
  readonly name2: string;
  readonly table: TableSize;
  readonly race: number;
  readonly shotClock: number;
}

export const DEFAULT_SETTINGS: Settings = {
  view: '3d',
  guide: 'long',
  speed: 1,
  sound: true,
  volume: 0.8,
  quality: 'auto',
  cloth: 'blueGreen',
  leftHanded: false,
  keepZoom: true,
  largeCards: true,
  menuBar: true,
  hints: false,
  name: 'Player 1',
  name2: 'Player 2',
  table: '9ft',
  race: 3,
  shotClock: 0,
};

export const PHONE_SETTINGS: Settings = { ...DEFAULT_SETTINGS, largeCards: false, menuBar: false };

/** The defaults for this device: a phone's screen is under 600 CSS pixels on its shorter side
 * (most are 360 to 430), a tablet's or a computer's larger. */
export function deviceDefaults(): Settings {
  const s = typeof screen === 'undefined' ? null : screen;
  return s && Math.min(s.width, s.height) < 600 ? PHONE_SETTINGS : DEFAULT_SETTINGS;
}

const KEY = 'pool.settings.v2';
/** Where settings were kept while the view refitted its zoom at each angle by default. They are
 * read once, the zoom kept from then on as it now is by default, and saved under KEY. */
const OLD_KEY = 'pool.settings.v1';
export const RACES = [1, 3, 5, 7] as const;
export const SHOT_CLOCKS = [0, 30, 60] as const;
export const SPEEDS = [1, 1.5, 2] as const;

/** Keeps every field of a stored value that is valid, and the default for the rest. */
export function sanitize(value: unknown, d: Settings = DEFAULT_SETTINGS): Settings {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const oneOf = <T>(x: unknown, options: readonly T[], fallback: T): T =>
    options.includes(x as T) ? (x as T) : fallback;
  const name = (x: unknown, fallback: string) =>
    typeof x === 'string' && x.trim().length > 0 ? x.trim().slice(0, 24) : fallback;
  return {
    view: oneOf(v.view, ['3d', 'top'] as const, d.view),
    guide: oneOf(v.guide, ['long', 'short', 'off'] as const, d.guide),
    speed: oneOf(v.speed, SPEEDS, d.speed),
    sound: typeof v.sound === 'boolean' ? v.sound : d.sound,
    volume: typeof v.volume === 'number' && v.volume >= 0 && v.volume <= 1 ? v.volume : d.volume,
    quality: oneOf(v.quality, ['auto', 'high', 'low'] as const, d.quality),
    cloth: oneOf(v.cloth, Object.keys(CLOTHS) as ClothName[], d.cloth),
    leftHanded: typeof v.leftHanded === 'boolean' ? v.leftHanded : d.leftHanded,
    keepZoom: typeof v.keepZoom === 'boolean' ? v.keepZoom : d.keepZoom,
    largeCards: typeof v.largeCards === 'boolean' ? v.largeCards : d.largeCards,
    menuBar: typeof v.menuBar === 'boolean' ? v.menuBar : d.menuBar,
    hints: typeof v.hints === 'boolean' ? v.hints : d.hints,
    name: name(v.name, d.name),
    name2: name(v.name2, d.name2),
    table: isTableSize(v.table) ? v.table : d.table,
    race: oneOf(v.race, RACES, d.race),
    shotClock: oneOf(v.shotClock, SHOT_CLOCKS, d.shotClock),
  };
}

export function loadSettings(
  storage: Storage | null = safeStorage(),
  defaults: Settings = deviceDefaults(),
): Settings {
  try {
    const raw = storage?.getItem(KEY);
    if (raw) return sanitize(JSON.parse(raw), defaults);
    const old = storage?.getItem(OLD_KEY);
    return old ? { ...sanitize(JSON.parse(old), defaults), keepZoom: true } : defaults;
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: Settings, storage: Storage | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(settings));
    storage?.removeItem(OLD_KEY);
  } catch {
    // Storage full or blocked: the settings last for this visit only.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
