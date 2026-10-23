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
// was the default move over once with the zoom kept and everything else as it was.

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../src/app/Settings.ts';

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
});
