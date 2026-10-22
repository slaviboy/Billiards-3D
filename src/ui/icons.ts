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

// The interface's icons, drawn for this game as inline SVG: thin line icons in the style of the
// author's chess game (some are its own), and the 8-ball mark.

const line = (d: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Thin line icons for the modern interface. */
export const LINE_ICONS = {
  plus: line('M12 5v14M5 12h14'),
  topView: line(
    'M5 4.5h14a.5.5 0 0 1 .5.5v14a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5zM4.5 12h15M12 4.5v15',
  ),
  /** A table in perspective: the 3D view. */
  perspective: line('M7 6.5h10l3.5 11h-17zM5.2 12h13.6M12 6.5v11'),
  fullscreen: line('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'),
  prev: line('M15 6l-6 6 6 6'),
  next: line('M9 6l6 6-6 6'),
  close: line('M6.5 6.5l11 11M17.5 6.5l-11 11'),
  chevronDown: line('M6 9.5l6 6 6-6'),
  chevronRight: line('M9.5 6l6 6-6 6'),
  check: line('M5 12.5l4.5 4.5L19 7.5'),
  menu: line('M4.5 7h15M4.5 12h15M4.5 17h15'),
  pause: line('M8.5 5.5v13M15.5 5.5v13'),
  sliders: line('M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5'),
  flag: line('M6 21V4M6 4.5h11l-2.5 4 2.5 4H6'),
  link: line(
    'M10 14a4.5 4.5 0 0 0 6.4.2l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.4 1.4M14 10a4.5 4.5 0 0 0-6.4-.2l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.4-1.4',
  ),
  copy: line('M9 9h10v10H9zM15 9V5H5v10h4'),
  users: line(
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16.5 4.3a3.5 3.5 0 0 1 0 6.4M18.5 14a6.5 6.5 0 0 1 3 6',
  ),
  globe: line(
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z',
  ),
  target: line(
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM12 11.5v1',
  ),
  book: line(
    'M5 4.5h5.5A2.5 2.5 0 0 1 13 7v13a2 2 0 0 0-2-2H5zM19 4.5h-5.5A2.5 2.5 0 0 0 11 7M19 4.5V18h-6',
  ),
  trophy: line(
    'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4',
  ),
  restart: line('M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4'),
  exit: line('M14 4.5h4.5v15H14M10 8l-4 4 4 4M6 12h10'),
  mic: line(
    'M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3zM6 11.5a6 6 0 0 0 12 0M12 17.5v3',
  ),
  micOff: line(
    'M15 10.5v-4a3 3 0 0 0-5.6-1.5M9 9v2.5a3 3 0 0 0 4.6 2.5M6 11.5a6 6 0 0 0 9.4 4.9M18 11.5a6 6 0 0 1-.4 2.1M12 17.5v3M4 4l16 16',
  ),
  camera: line(
    'M4.5 7h9a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 3 15.5v-7A1.5 1.5 0 0 1 4.5 7zM15 10.5l5-3v9l-5-3',
  ),
  cameraOff: line(
    'M9 7h4.5A1.5 1.5 0 0 1 15 8.5v3M15 15.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 3 15.5v-7A1.5 1.5 0 0 1 4.5 7M15 10.5l5-3v9l-3.5-2.1M4 4l16 16',
  ),
  speaker: line('M4 9.5h3.5L12 6v12l-4.5-3.5H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11'),
  speakerOff: line('M4 9.5h3.5L12 6v12l-4.5-3.5H4zM16 9.5l5 5M21 9.5l-5 5'),
} as const;

/** The 8-ball: the game's mark. */
export const EIGHT_BALL = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="#141414" stroke="rgba(255,255,255,0.18)" stroke-width="0.8"/><circle cx="12" cy="11.2" r="4.6" fill="#f3efe2"/><path d="M12 7.7a1.55 1.55 0 1 0 0 3.1 1.55 1.55 0 0 0 0-3.1zM12 10.8a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8z" fill="none" stroke="#151515" stroke-width="1.15"/><ellipse cx="8.2" cy="6.8" rx="2.6" ry="1.4" fill="rgba(255,255,255,0.22)" transform="rotate(-30 8.2 6.8)"/></svg>`;

/** A small ball glyph in a ball's colour (striped for 9–15), for the players' rows of balls. */
export function ballGlyph(colour: string, stripe: boolean, size = 16): string {
  const body = stripe
    ? `<circle cx="8" cy="8" r="7" fill="#f3efe2"/><path d="M1.6 5h12.8v6H1.6z" fill="${colour}" clip-path="circle(7px at 8px 8px)"/>`
    : `<circle cx="8" cy="8" r="7" fill="${colour}"/>`;
  return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true">${body}<circle cx="8" cy="8" r="2.6" fill="#f3efe2" opacity="0.9"/><circle cx="8" cy="8" r="7" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="0.6"/></svg>`;
}
