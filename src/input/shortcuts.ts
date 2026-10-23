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

// The keyboard, laid out as on the chess board: the arrows, Page Up and Down and Home move the
// camera; Shift with the arrows plays (aim and power), as Shift with the arrows moves pieces
// there. One table gives both what each key does and the help that lists them, so the two cannot
// drift apart.

const DEG = Math.PI / 180;

export type Command =
  | { readonly kind: 'orbit'; readonly azimuth: number; readonly elevation: number }
  | { readonly kind: 'zoom'; readonly factor: number }
  | { readonly kind: 'home' }
  | { readonly kind: 'flip' }
  | { readonly kind: 'toggleView' }
  | { readonly kind: 'aim'; readonly angle: number }
  | { readonly kind: 'power'; readonly delta: number }
  | { readonly kind: 'tip'; readonly a: number; readonly b: number }
  | { readonly kind: 'centreTip' }
  | { readonly kind: 'shoot' }
  | { readonly kind: 'guide' }
  | { readonly kind: 'sound' }
  | { readonly kind: 'pause' }
  | { readonly kind: 'newGame' }
  | { readonly kind: 'help' };

export const KEY_ROTATE = 5 * DEG;
export const KEY_TILT = 3 * DEG;
export const KEY_ZOOM = 0.9;
export const AIM_STEP = 0.5 * DEG;
export const FINE_AIM_STEP = 0.05 * DEG;
export const POWER_STEP = 0.05;
export const TIP_STEP = 0.05;

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>;

/** The command a key press gives, or null for a key the game leaves alone. */
export function commandFor(event: KeyEventLike): Command | null {
  if (event.altKey) return null;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (mod) return !event.shiftKey && key === 'n' ? { kind: 'newGame' } : null;
  if (event.shiftKey) {
    switch (key) {
      case 'ArrowLeft':
        return { kind: 'aim', angle: AIM_STEP };
      case 'ArrowRight':
        return { kind: 'aim', angle: -AIM_STEP };
      case 'ArrowUp':
        return { kind: 'power', delta: POWER_STEP };
      case 'ArrowDown':
        return { kind: 'power', delta: -POWER_STEP };
      case '?':
        return { kind: 'help' };
      default:
        return null;
    }
  }
  switch (key) {
    case 'ArrowLeft':
      return { kind: 'orbit', azimuth: KEY_ROTATE, elevation: 0 };
    case 'ArrowRight':
      return { kind: 'orbit', azimuth: -KEY_ROTATE, elevation: 0 };
    case 'ArrowUp':
      return { kind: 'orbit', azimuth: 0, elevation: KEY_TILT };
    case 'ArrowDown':
      return { kind: 'orbit', azimuth: 0, elevation: -KEY_TILT };
    case 'PageUp':
      return { kind: 'zoom', factor: KEY_ZOOM };
    case 'PageDown':
      return { kind: 'zoom', factor: 1 / KEY_ZOOM };
    case 'Home':
      return { kind: 'home' };
    case 't':
      return { kind: 'toggleView' };
    case 'f':
      return { kind: 'flip' };
    case ',':
      return { kind: 'aim', angle: FINE_AIM_STEP };
    case '.':
      return { kind: 'aim', angle: -FINE_AIM_STEP };
    case 'i':
      return { kind: 'tip', a: 0, b: TIP_STEP };
    case 'k':
      return { kind: 'tip', a: 0, b: -TIP_STEP };
    case 'j':
      return { kind: 'tip', a: TIP_STEP, b: 0 };
    case 'l':
      return { kind: 'tip', a: -TIP_STEP, b: 0 };
    case 'c':
      return { kind: 'centreTip' };
    case ' ':
    case 'Enter':
      return { kind: 'shoot' };
    case 'g':
      return { kind: 'guide' };
    case 'm':
      return { kind: 'sound' };
    case 'Escape':
      return { kind: 'pause' };
    case '?':
      return { kind: 'help' };
    default:
      return null;
  }
}

/** Every key and mouse control, for the help, grouped. */
export const CONTROLS_HELP: readonly {
  readonly title: string;
  readonly rows: readonly (readonly [keys: string, action: string])[];
}[] = [
  {
    title: 'Shooting',
    rows: [
      ['Drag on the cloth', 'Aim (with a finger, sweep round the cue ball)'],
      ['Shift + ← →', 'Aim'],
      [', .', 'Aim finely'],
      ['Shift + ↑ ↓', 'Power'],
      ['Pull the power bar back, let go', 'Shoot'],
      ['Back to the top of the power bar, let go', 'Stop the pull without shooting'],
      ['Space, Enter', 'Shoot'],
      ['I J K L', 'Move the tip on the cue ball (spin)'],
      ['C', 'Centre the tip'],
      ['Drag the cue ball', 'Place it, when it is in hand'],
    ],
  },
  {
    title: 'Camera',
    rows: [
      ['Drag a rail corner or the floor', 'Turn and tilt the view'],
      ['Drag a rail side', 'Pan the view'],
      ['Right-drag anywhere', 'Turn and tilt'],
      ['Middle-drag anywhere', 'Pan'],
      ['Mouse wheel, PgUp / PgDn', 'Zoom'],
      ['← →', 'Turn the view'],
      ['↑ ↓', 'Tilt the view (3D)'],
      ['Home', 'Reset the view'],
      ['F', 'Look from the other end'],
      ['T', 'Top view / 3D view'],
      ['Two fingers', 'Twist to turn, pinch to zoom, drag to tilt and pan'],
    ],
  },
  {
    title: 'Game',
    rows: [
      ['G', 'Aiming guide: long, short, off'],
      ['M', 'Sound on or off'],
      ['Esc', 'Pause menu'],
      ['Ctrl+N', 'New game'],
      ['?', 'This list'],
    ],
  },
];
