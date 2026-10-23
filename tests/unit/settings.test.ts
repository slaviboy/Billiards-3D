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

// The settings: a new player keeps the zoom while the view turns, and settings saved before that
// was the default move over once with the zoom kept and everything else as it was. A tablet or a
// computer starts with large player cards and the menu bar, a phone with neither.

import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  deviceDefaults,
  loadSettings,
  PHONE_SETTINGS,
  saveSettings,
} from '../../src/app/Settings.ts';

function storage(items: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(items));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}

describe('the settings', () => {
  it('keep the zoom while the view turns, for a new player', () => {
    expect(DEFAULT_SETTINGS.keepZoom).toBe(true);
    expect(loadSettings(storage()).keepZoom).toBe(true);
  });

  it('move over from before, the zoom kept and the rest as it was', () => {
    const old = storage({
      'pool.settings.v1': JSON.stringify({ keepZoom: false, name: 'Ada', cloth: 'electricBlue' }),
    });
    const loaded = loadSettings(old);
    expect(loaded).toMatchObject({ keepZoom: true, name: 'Ada', cloth: 'electricBlue' });
    saveSettings(loaded, old);
    expect(old.getItem('pool.settings.v1')).toBeNull();
    expect(loadSettings(old)).toEqual(loaded);
  });

  it('keep a choice made since, the zoom refitted included', () => {
    const saved = storage();
    saveSettings({ ...DEFAULT_SETTINGS, keepZoom: false }, saved);
    expect(loadSettings(saved).keepZoom).toBe(false);
  });

  it('tell a phone from a tablet or a computer by the screen', () => {
    try {
      for (const [width, height, phone] of [
        [390, 844, true],
        [844, 390, true],
        [820, 1180, false],
        [1920, 1080, false],
      ] as const) {
        vi.stubGlobal('screen', { width, height });
        expect(deviceDefaults()).toBe(phone ? PHONE_SETTINGS : DEFAULT_SETTINGS);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('start large cards and the menu bar on a tablet or a computer, not on a phone', () => {
    const big = { largeCards: true, menuBar: true };
    const small = { largeCards: false, menuBar: false };
    expect(loadSettings(storage(), DEFAULT_SETTINGS)).toMatchObject(big);
    expect(loadSettings(storage(), PHONE_SETTINGS)).toMatchObject(small);
    // Settings saved before these were chosen take the device's choice, the rest as saved.
    const before = storage({ 'pool.settings.v2': JSON.stringify({ name: 'Ada' }) });
    expect(loadSettings(before, DEFAULT_SETTINGS)).toMatchObject({ name: 'Ada', ...big });
    expect(loadSettings(before, PHONE_SETTINGS)).toMatchObject({ name: 'Ada', ...small });
    // A choice made stays, and a damaged one is the device's.
    const saved = storage();
    saveSettings({ ...DEFAULT_SETTINGS, largeCards: false, menuBar: false }, saved);
    expect(loadSettings(saved, DEFAULT_SETTINGS)).toMatchObject(small);
    const damaged = storage({
      'pool.settings.v2': JSON.stringify({ largeCards: 'yes', menuBar: 1 }),
    });
    expect(loadSettings(damaged, PHONE_SETTINGS)).toMatchObject(small);
  });
});

describe('the hints on hover', () => {
  it('show by default on every device, and stay off once turned off', () => {
    expect(loadSettings(storage(), DEFAULT_SETTINGS).hints).toBe(true);
    expect(loadSettings(storage(), PHONE_SETTINGS).hints).toBe(true);
    const saved = storage();
    saveSettings({ ...DEFAULT_SETTINGS, hints: false }, saved);
    expect(loadSettings(saved, DEFAULT_SETTINGS).hints).toBe(false);
  });
});
