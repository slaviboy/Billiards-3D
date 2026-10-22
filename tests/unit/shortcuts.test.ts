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

// The keyboard: the camera keys as on the chess board, Shift with the arrows for aim and power,
// and every key the help lists does what it says.

import { describe, expect, it } from 'vitest';
import { CONTROLS_HELP, commandFor, KEY_ROTATE, KEY_TILT } from '../../src/input/shortcuts.ts';

const key = (k: string, mods: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {}) => ({
  key: k,
  shiftKey: mods.shift ?? false,
  ctrlKey: mods.ctrl ?? false,
  metaKey: false,
  altKey: mods.alt ?? false,
});

describe('the keyboard', () => {
  it('moves the camera with the arrows, Page Up and Down and Home, as on the chess board', () => {
    expect(commandFor(key('ArrowLeft'))).toEqual({
      kind: 'orbit',
      azimuth: KEY_ROTATE,
      elevation: 0,
    });
    expect(commandFor(key('ArrowRight'))).toEqual({
      kind: 'orbit',
      azimuth: -KEY_ROTATE,
      elevation: 0,
    });
    expect(commandFor(key('ArrowUp'))).toEqual({ kind: 'orbit', azimuth: 0, elevation: KEY_TILT });
    expect(commandFor(key('PageUp'))).toMatchObject({ kind: 'zoom' });
    expect((commandFor(key('PageUp')) as { factor: number }).factor).toBeLessThan(1);
    expect((commandFor(key('PageDown')) as { factor: number }).factor).toBeGreaterThan(1);
    expect(commandFor(key('Home'))).toEqual({ kind: 'home' });
    expect(commandFor(key('t'))).toEqual({ kind: 'toggleView' });
    expect(commandFor(key('T'))).toEqual({ kind: 'toggleView' });
    expect(commandFor(key('f'))).toEqual({ kind: 'flip' });
  });

  it('aims and sets the power with Shift and the arrows, and shoots with Space or Enter', () => {
    const left = commandFor(key('ArrowLeft', { shift: true }));
    const right = commandFor(key('ArrowRight', { shift: true }));
    expect(left).toMatchObject({ kind: 'aim' });
    expect((left as { angle: number }).angle).toBeGreaterThan(0);
    expect((right as { angle: number }).angle).toBe(-(left as { angle: number }).angle);
    const fine = commandFor(key(','));
    expect(Math.abs((fine as { angle: number }).angle)).toBeLessThan(
      (left as { angle: number }).angle,
    );
    expect(commandFor(key('ArrowUp', { shift: true }))).toMatchObject({ kind: 'power' });
    expect(commandFor(key(' '))).toEqual({ kind: 'shoot' });
    expect(commandFor(key('Enter'))).toEqual({ kind: 'shoot' });
  });

  it('moves the tip with I J K L: J to the left of the ball (positive a), I up', () => {
    expect(commandFor(key('j'))).toMatchObject({ kind: 'tip', b: 0 });
    expect((commandFor(key('j')) as { a: number }).a).toBeGreaterThan(0);
    expect((commandFor(key('l')) as { a: number }).a).toBeLessThan(0);
    expect((commandFor(key('i')) as { b: number }).b).toBeGreaterThan(0);
    expect((commandFor(key('k')) as { b: number }).b).toBeLessThan(0);
    expect(commandFor(key('c'))).toEqual({ kind: 'centreTip' });
  });

  it('leaves Alt combinations and unknown keys to the browser', () => {
    expect(commandFor(key('ArrowLeft', { alt: true }))).toBeNull();
    expect(commandFor(key('z'))).toBeNull();
    expect(commandFor(key('r', { ctrl: true }))).toBeNull();
    expect(commandFor(key('n', { ctrl: true }))).toEqual({ kind: 'newGame' });
  });

  it('lists in the help every key it answers to', () => {
    const listed = CONTROLS_HELP.flatMap((s) => s.rows.map(([keys]) => keys)).join(' ');
    for (const k of ['Home', 'PgUp', 'PgDn', 'Space', 'Enter', 'Esc', 'Ctrl+N', '?']) {
      expect(listed).toContain(k);
    }
    for (const letter of ['T', 'F', 'G', 'M', 'C', 'I J K L']) expect(listed).toContain(letter);
  });
});
