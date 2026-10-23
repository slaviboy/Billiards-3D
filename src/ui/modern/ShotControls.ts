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

// The controls for the shot itself:
//
//   PowerBar   a bar along the screen's edge: press and pull down to draw the cue back, let go to
//              shoot. Each shot starts from no power, the bar showing which way to pull; back at
//              its start, letting go takes nothing, so a pull can be stopped to aim again.
//   SpinPad    the cue ball's face, with the cue tip's point on it: drag the point for top, draw
//              and side; a double click or its button centres it. The spin reads beside it.
//   ElevationSlider  the cue's elevation, a groove dragged along or stepped with the keys.
//   FineAim    a ridged wheel: drag it sideways to turn the aim by small steps; stepButton, a
//              button that steps once, then again while held, sits on either side of it.

import { el } from '../Dialog.ts';
import { LINE_ICONS } from '../icons.ts';

/** Keeps a drag's pointer on the control even when it leaves it (a pointer already gone is not). */
function capture(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // The pointer has lifted already: nothing to keep.
  }
}

/** How far from the centre the tip may strike, in ball radii (beyond it the cue miscues). */
export const MAX_TIP = 0.5;
export const MAX_ELEVATION = 30;

/**
 * The start of the power bar, as a part of the pull: letting go above it shoots nothing and puts
 * the cue back, the way to stop a pull and aim again. Below it the keys do not shoot either.
 */
export const CANCEL_PULL = 0.06;

/** The power's colours from none to full: mint, lime, gold, coral, red. */
const POWER_STOPS: readonly (readonly [at: number, rgb: readonly [number, number, number]])[] = [
  [0, [69, 211, 154]],
  [0.35, [181, 230, 85]],
  [0.6, [244, 201, 93]],
  [0.8, [245, 154, 91]],
  [1, [239, 90, 90]],
];

/** The colour of power `p` (0–1) on the bar's scale. */
export function powerColor(p: number): string {
  const t = Math.min(1, Math.max(0, p));
  let i = 1;
  while (i < POWER_STOPS.length - 1 && POWER_STOPS[i]![0] < t) i++;
  const [a, from] = POWER_STOPS[i - 1]!;
  const [b, to] = POWER_STOPS[i]!;
  const k = b > a ? (t - a) / (b - a) : 0;
  const rgb = from.map((c, j) => Math.round(c + (to[j]! - c) * k));
  return `rgb(${rgb.join(', ')})`;
}

const POWER_GRADIENT = `linear-gradient(180deg, ${POWER_STOPS.map(
  ([at, rgb]) => `rgb(${rgb.join(', ')}) ${at * 100}%`,
).join(', ')})`;

export interface PowerHandlers {
  canShoot(): boolean;
  power(): number;
  /** The power while pulling back (the cue follows). */
  pull(power: number): void;
  /** Let go: shoot with this power. */
  release(power: number): void;
  /** Let go at the top: no shot; the power goes back to what it was. */
  cancel(previous: number): void;
}

export class PowerBar {
  readonly element: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly value: HTMLElement;
  private readonly track: HTMLElement;
  private drag: { pointer: number; previous: number } | null = null;

  constructor(private readonly handlers: PowerHandlers) {
    this.element = el('div', 'm-card power');
    this.element.dataset.testid = 'power';
    this.element.dataset.tip = 'Pull down and let go to shoot';
    this.element.style.setProperty('--power-gradient', POWER_GRADIENT);
    const label = el('div', 'power-label', 'Power');
    this.value = el('div', 'power-value');
    this.track = el('div', 'power-track');
    this.track.setAttribute('role', 'slider');
    this.track.setAttribute('aria-label', 'Power: pull down and let go to shoot');
    this.track.setAttribute('aria-valuemin', '0');
    this.track.setAttribute('aria-valuemax', '100');
    this.track.tabIndex = 0;
    this.fill = el('div', 'power-fill');
    const cue = el('div', 'power-cue');
    // The start of the bar, where letting go shoots nothing; and, while there is no pull, chevrons
    // running down it to show which way to pull.
    const cancel = el('div', 'power-cancel');
    cancel.innerHTML = LINE_ICONS.close;
    const hint = el('div', 'power-hint');
    hint.innerHTML = LINE_ICONS.chevronDown.repeat(3);
    hint.setAttribute('aria-hidden', 'true');
    this.track.style.setProperty('--cancel', String(CANCEL_PULL));
    this.track.append(this.fill, cancel, hint, cue);
    this.element.append(label, this.track, this.value);
    this.track.addEventListener('pointerdown', this.onDown);
    this.track.addEventListener('pointermove', this.onMove);
    this.track.addEventListener('pointerup', this.onUp);
    this.track.addEventListener('pointercancel', this.onCancel);
    this.track.addEventListener('keydown', this.onKey);
  }

  get pulling(): boolean {
    return this.drag !== null;
  }

  private at(clientY: number): number {
    const rect = this.track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height)));
  }

  private readonly onDown = (event: PointerEvent) => {
    if (!this.handlers.canShoot() || this.drag) return;
    event.preventDefault();
    capture(this.track, event.pointerId);
    this.drag = { pointer: event.pointerId, previous: this.handlers.power() };
    this.element.classList.add('pulling');
    this.handlers.pull(this.at(event.clientY));
    this.render();
  };

  private readonly onMove = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointer) return;
    this.handlers.pull(this.at(event.clientY));
    this.render();
  };

  private readonly onUp = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) return;
    this.drag = null;
    this.element.classList.remove('pulling');
    const power = this.at(event.clientY);
    if (power < CANCEL_PULL || !this.handlers.canShoot()) this.handlers.cancel(drag.previous);
    else this.handlers.release(power);
    this.render();
  };

  private readonly onCancel = () => {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.element.classList.remove('pulling');
    this.handlers.cancel(drag.previous);
    this.render();
  };

  /** Escape while pulling puts the cue back without a shot. */
  cancelPull(): boolean {
    if (!this.drag) return false;
    this.onCancel();
    return true;
  }

  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.cancelPull()) event.stopPropagation();
  };

  render(): void {
    const power = this.handlers.power();
    const percent = Math.round(power * 100);
    const canShoot = this.handlers.canShoot();
    // Ready with no pull yet: "Pull". Pulled back to the start: letting go cancels.
    const idle = canShoot && !this.drag && power < CANCEL_PULL;
    const cancelling = this.drag !== null && power < CANCEL_PULL;
    this.fill.style.height = `${percent}%`;
    this.element.style.setProperty('--power', String(power));
    this.element.style.setProperty('--power-color', powerColor(power));
    this.value.textContent = idle ? 'Pull' : cancelling ? 'Cancel' : `${percent}%`;
    this.track.setAttribute('aria-valuenow', String(percent));
    this.track.setAttribute('aria-valuetext', this.value.textContent);
    this.element.classList.toggle('idle', idle);
    this.element.classList.toggle('cancelling', cancelling);
    this.element.classList.toggle('disabled', !canShoot);
  }
}

export interface SpinHandlers {
  tip(): { a: number; b: number };
  setTip(a: number, b: number): void;
  enabled(): boolean;
}

const EIGHTHS = ['', '⅛', '¼', '⅜', '½'] as const;

/**
 * The spin in words, in eighths of the ball's radius from its centre: top or draw ("Stun" at the
 * centre's height), and side ("No side" at the centre's).
 */
export function spinWords(a: number, b: number): [string, string] {
  const amount = (x: number) => EIGHTHS[Math.min(4, Math.round(Math.abs(x) * 8))]!;
  const height = amount(b);
  const side = amount(a);
  return [
    height ? `${b > 0 ? 'Top' : 'Draw'} ${height}` : 'Stun',
    side ? `${a > 0 ? 'Left' : 'Right'} ${side}` : 'No side',
  ];
}

export class SpinPad {
  readonly element: HTMLElement;
  private readonly ball: HTMLElement;
  private readonly dot: HTMLElement;
  private readonly height: HTMLElement;
  private readonly side: HTMLElement;
  private readonly centre: HTMLButtonElement;
  private dragging = -1;

  constructor(private readonly handlers: SpinHandlers) {
    this.element = el('div', 'spin');
    this.element.dataset.testid = 'spin';
    this.ball = el('div', 'spin-ball');
    this.ball.setAttribute('role', 'group');
    this.ball.setAttribute('aria-label', 'Where the cue strikes the cue ball: drag for spin');
    this.ball.dataset.tip = 'Spin: drag the point (I J K L)';
    const limit = el('div', 'spin-limit');
    this.dot = el('div', 'spin-dot');
    this.ball.append(limit, this.dot);
    // The spin in words, and a button to strike the centre again.
    const readout = el('div', 'spin-readout');
    readout.setAttribute('aria-live', 'polite');
    this.height = el('span', 'spin-height');
    this.side = el('span', 'spin-side');
    this.centre = el('button', 'm-icon-btn spin-centre');
    this.centre.type = 'button';
    this.centre.innerHTML = LINE_ICONS.restart;
    this.centre.setAttribute('aria-label', 'Strike the centre (C)');
    this.centre.dataset.tip = 'Strike the centre (C)';
    this.centre.addEventListener('click', () => {
      if (this.handlers.enabled()) this.handlers.setTip(0, 0);
      this.render();
    });
    readout.append(this.height, this.side, this.centre);
    this.element.append(this.ball, readout);

    this.ball.addEventListener('pointerdown', (event) => {
      if (!this.handlers.enabled()) return;
      event.preventDefault();
      this.dragging = event.pointerId;
      capture(this.ball, event.pointerId);
      this.moveTo(event.clientX, event.clientY);
    });
    this.ball.addEventListener('pointermove', (event) => {
      if (event.pointerId === this.dragging) this.moveTo(event.clientX, event.clientY);
    });
    const stop = (event: PointerEvent) => {
      if (event.pointerId === this.dragging) this.dragging = -1;
    };
    this.ball.addEventListener('pointerup', stop);
    this.ball.addEventListener('pointercancel', stop);
    this.ball.addEventListener('dblclick', () => {
      if (this.handlers.enabled()) this.handlers.setTip(0, 0);
      this.render();
    });
  }

  private moveTo(clientX: number, clientY: number): void {
    const rect = this.ball.getBoundingClientRect();
    const r = rect.width / 2;
    // The point on the ball's face as the shooter sees it: a to the shooter's left, b up.
    let a = -(clientX - (rect.left + r)) / r;
    let b = -(clientY - (rect.top + r)) / r;
    const length = Math.hypot(a, b);
    if (length > MAX_TIP) {
      a *= MAX_TIP / length;
      b *= MAX_TIP / length;
    }
    this.handlers.setTip(a, b);
    this.render();
  }

  render(): void {
    const { a, b } = this.handlers.tip();
    // Offsets as a share of the ball's radius, from the centre.
    this.dot.style.left = `${50 - a * 50}%`;
    this.dot.style.top = `${50 - b * 50}%`;
    const [height, side] = spinWords(a, b);
    this.height.textContent = height;
    this.side.textContent = side;
    const enabled = this.handlers.enabled();
    this.element.classList.toggle('disabled', !enabled);
    this.centre.disabled = !enabled || (a === 0 && b === 0);
  }
}

export interface ElevationHandlers {
  elevation(): number;
  setElevation(degrees: number): void;
  enabled(): boolean;
}

/**
 * The cue's elevation: a groove as wide as a finger, dragged anywhere along it (up raises the
 * cue), or stepped with the arrow keys, Page Up and Down, Home and End.
 */
export class ElevationSlider {
  readonly element: HTMLElement;
  private readonly track: HTMLElement;
  private readonly value: HTMLElement;
  private raising = -1;

  constructor(private readonly handlers: ElevationHandlers) {
    this.element = el('div', 'spin-elevation');
    this.element.dataset.tip = 'Cue elevation';
    this.track = el('div', 'elevation-track');
    this.track.tabIndex = 0;
    this.track.setAttribute('role', 'slider');
    this.track.setAttribute('aria-label', 'Cue elevation in degrees');
    this.track.setAttribute('aria-orientation', 'vertical');
    this.track.setAttribute('aria-valuemin', '0');
    this.track.setAttribute('aria-valuemax', String(MAX_ELEVATION));
    this.track.append(el('div', 'elevation-fill'), el('div', 'elevation-grip'));
    this.value = el('span', 'spin-elevation-value');
    this.element.append(this.track, this.value);

    this.track.addEventListener('pointerdown', (event) => {
      if (!this.handlers.enabled()) return;
      event.preventDefault();
      this.raising = event.pointerId;
      capture(this.track, event.pointerId);
      this.raiseTo(event.clientY);
    });
    this.track.addEventListener('pointermove', (event) => {
      if (event.pointerId === this.raising) this.raiseTo(event.clientY);
    });
    const lower = (event: PointerEvent) => {
      if (event.pointerId === this.raising) this.raising = -1;
    };
    this.track.addEventListener('pointerup', lower);
    this.track.addEventListener('pointercancel', lower);
    this.track.addEventListener('keydown', (event) => {
      if (!this.handlers.enabled()) return;
      const degrees = Math.round(this.handlers.elevation());
      const next =
        event.key === 'ArrowUp' || event.key === 'ArrowRight'
          ? degrees + 1
          : event.key === 'ArrowDown' || event.key === 'ArrowLeft'
            ? degrees - 1
            : event.key === 'PageUp'
              ? degrees + 5
              : event.key === 'PageDown'
                ? degrees - 5
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? MAX_ELEVATION
                    : null;
      if (next === null) return;
      // The keys work the slider here, not the camera.
      event.preventDefault();
      event.stopPropagation();
      this.handlers.setElevation(Math.max(0, Math.min(MAX_ELEVATION, next)));
      this.render();
    });
  }

  private raiseTo(clientY: number): void {
    const rect = this.track.getBoundingClientRect();
    const share = 1 - (clientY - rect.top) / Math.max(1, rect.height);
    this.handlers.setElevation(Math.round(Math.max(0, Math.min(1, share)) * MAX_ELEVATION));
    this.render();
  }

  render(): void {
    const degrees = Math.round(this.handlers.elevation());
    this.track.style.setProperty('--elevation', String(degrees / MAX_ELEVATION));
    this.track.setAttribute('aria-valuenow', String(degrees));
    this.value.textContent = `${degrees}°`;
    const enabled = this.handlers.enabled();
    this.element.classList.toggle('disabled', !enabled);
    this.track.setAttribute('aria-disabled', String(!enabled));
  }
}

/** Delay before a held step button repeats, and the time between its repeats, in ms. */
const HOLD_DELAY = 380;
const HOLD_EVERY = 60;

/** A button that takes its step once when pressed, then again and again while it is held. */
export function stepButton(
  icon: string,
  label: string,
  step: () => void,
  enabled: () => boolean,
): HTMLButtonElement {
  const button = el('button', 'm-icon-btn step-btn');
  button.type = 'button';
  button.innerHTML = icon;
  button.setAttribute('aria-label', label);
  button.dataset.tip = label;
  let timer = 0;
  const stop = () => {
    window.clearTimeout(timer);
    window.clearInterval(timer);
    timer = 0;
  };
  button.addEventListener('pointerdown', (event) => {
    if (!enabled()) return;
    event.preventDefault();
    capture(button, event.pointerId);
    step();
    stop();
    timer = window.setTimeout(() => {
      timer = window.setInterval(step, HOLD_EVERY);
    }, HOLD_DELAY);
  });
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointercancel', stop);
  button.addEventListener('lostpointercapture', stop);
  // From the keyboard (Enter or Space on the button), one step a press.
  button.addEventListener('click', (event) => {
    if (event.detail === 0 && enabled()) step();
  });
  return button;
}

/** Radians of aim per pixel the wheel is dragged. */
const FINE_PER_PIXEL = 0.0004;

export class FineAim {
  readonly element: HTMLElement;
  private last: { pointer: number; x: number } | null = null;
  private offset = 0;

  constructor(
    turn: (angle: number) => void,
    private readonly enabled: () => boolean,
  ) {
    this.element = el('div', 'fine-aim');
    this.element.dataset.testid = 'fine-aim';
    this.element.dataset.tip = 'Fine aim: drag sideways (, and .)';
    this.element.setAttribute('aria-label', 'Fine aim: drag sideways');
    const ridges = el('div', 'fine-ridges');
    this.element.append(ridges);
    this.element.addEventListener('pointerdown', (event) => {
      if (!this.enabled()) return;
      event.preventDefault();
      capture(this.element, event.pointerId);
      this.last = { pointer: event.pointerId, x: event.clientX };
    });
    this.element.addEventListener('pointermove', (event) => {
      if (!this.last || event.pointerId !== this.last.pointer) return;
      const dx = event.clientX - this.last.x;
      this.last.x = event.clientX;
      this.offset += dx;
      ridges.style.backgroundPositionX = `${this.offset}px`;
      // Dragging the wheel's top to the right turns the aim clockwise.
      turn(-dx * FINE_PER_PIXEL);
    });
    const stop = () => {
      this.last = null;
    };
    this.element.addEventListener('pointerup', stop);
    this.element.addEventListener('pointercancel', stop);
    this.element.addEventListener(
      'wheel',
      (event) => {
        if (!this.enabled()) return;
        event.preventDefault();
        event.stopPropagation();
        this.offset -= event.deltaY * 0.2;
        ridges.style.backgroundPositionX = `${this.offset}px`;
        turn(event.deltaY * 0.2 * FINE_PER_PIXEL);
      },
      { passive: false },
    );
  }

  render(): void {
    this.element.classList.toggle('disabled', !this.enabled());
  }
}
