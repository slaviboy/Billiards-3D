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

// Pointer and touch input on the table. What a drag does depends on where it starts, as on the
// chess board:
//
//   the cloth        aims: with a mouse the cue points at the pointer; with a finger the aim turns
//                    as far as the finger sweeps round the cue ball, so the finger never hides what
//                    it aims at. On the cue ball, when it is in hand, the drag moves it instead.
//                    While it is not this player's turn, the cloth turns the view.
//   a rail's corner  turns and tilts the view (so does the floor round the table).
//   a rail's side    pans: the grabbed point of the table stays under the pointer.
//   right button     turns and tilts, anywhere; the middle button pans.
//                    In the top view, turning drags turn the table round like a dial.
//   wheel            zooms.
//   two fingers      twist to turn, pinch to zoom, move up and down to tilt (in the top view, to
//                    pan), sideways to pan.
//
// Points are taken on the plane of the balls' centres and given in the table's frame.

import { Plane, Raycaster, Vector2, Vector3, type Camera } from 'three';
import { fromScene } from '../table/frame.ts';
import { BALL_RADIUS } from '../table/spec.ts';

const R = BALL_RADIUS;
const DEG = Math.PI / 180;
const ROTATE_PER_PIXEL = 0.35 * DEG;
const TILT_PER_PIXEL = 0.25 * DEG;
/** How near the point the top view turns about a drag may come and still turn it, CSS pixels. */
const PIVOT_CLEARANCE = 24;
/** How far along each rail from a corner the corner's turning handle reaches, metres. */
const CORNER_REACH = 0.14;

export type Zone = 'cloth' | 'corner' | 'edge' | 'floor';

export interface TableInputHandlers {
  /** Whether the player at this device may aim or place now. */
  canAct(): boolean;
  /** The cue ball's centre, or null. */
  cueBall(): { x: number; y: number } | null;
  /** Whether the cue ball may be moved by hand. */
  inHand(): boolean;
  /** Aims at a point of the table. */
  aimAt(x: number, y: number): void;
  /** Turns the aim by an angle (radians, counter-clockwise seen from above). */
  turnAim(angle: number): void;
  /** Tries to put the cue ball here; false if it may not go there. */
  moveCueBall(x: number, y: number): boolean;
  /** The player let go of the cue ball. */
  placed(): void;
  /** Turns (a larger azimuth turns the table clockwise on screen) and tilts the view. */
  orbit(dAzimuth: number, dElevation: number): void;
  zoom(factor: number): void;
  /** Moves the point looked at by this much (scene metres). */
  pan(dx: number, dz: number): void;
  /** Whether the view tilts (the 3D view); the top view pans instead with two fingers. */
  tilts(): boolean;
  /** The table's size, for the frame conversion and the zones. */
  table(): { W: number; L: number; railWidth: number };
  camera(): Camera;
}

type Drag =
  | { kind: 'aim' }
  | { kind: 'place' }
  | { kind: 'rotate'; lastX: number; lastY: number }
  | { kind: 'pan'; anchor: Vector3 }
  | { kind: 'gesture'; span: number; angle: number; centre: Vector2 };

function svgCursor(svg: string, x: number, y: number, fallback: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;
}

// Original cursor art (the chess game's): a circular double arrow for turning, a four-way arrow
// for panning.
const ROTATE_CURSOR = svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14a8 8 0 0 1 14-5.3M22 14a8 8 0 0 1-14 5.3" stroke="#000" stroke-width="5"/><path d="M6 14a8 8 0 0 1 14-5.3M22 14a8 8 0 0 1-14 5.3" stroke="#fff" stroke-width="2.4"/><path d="M21 4v5h-5M7 24v-5h5" stroke="#000" stroke-width="5"/><path d="M21 4v5h-5M7 24v-5h5" stroke="#fff" stroke-width="2.4"/></g></svg>`,
  14,
  14,
  'grab',
);
const PAN_CURSOR = svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v22M3 14h22M10 7l4-4 4 4M10 21l4 4 4-4M7 10l-4 4 4 4M21 10l4 4-4 4" stroke="#000" stroke-width="5"/><path d="M14 3v22M3 14h22M10 7l4-4 4 4M10 21l4 4 4-4M7 10l-4 4 4 4M21 10l4 4-4 4" stroke="#fff" stroke-width="2.2"/></g></svg>`,
  14,
  14,
  'move',
);

export class TableInput {
  private drag: Drag | null = null;
  private dragPointer = -1;
  private readonly pointers = new Map<number, { x: number; y: number; touch: boolean }>();
  private readonly raycaster = new Raycaster();
  private readonly plane = new Plane(new Vector3(0, 1, 0), -R);
  private readonly ndc = new Vector2();
  private readonly hit = new Vector3();
  private readonly eye = new Vector3();
  private readonly look = new Vector3();
  private readonly table = { x: 0, y: 0, z: 0 };
  enabled = true;

  constructor(
    private readonly element: HTMLElement,
    private readonly handlers: TableInputHandlers,
  ) {
    element.addEventListener('pointerdown', this.onDown);
    element.addEventListener('pointermove', this.onMove);
    element.addEventListener('pointerup', this.onUp);
    element.addEventListener('pointercancel', this.onUp);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('contextmenu', this.onContextMenu);
  }

  /** The point of the balls' plane under a screen point (scene frame), or null. */
  private scenePoint(clientX: number, clientY: number, out = new Vector3()): Vector3 | null {
    const rect = this.element.getBoundingClientRect();
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.handlers.camera());
    return this.raycaster.ray.intersectPlane(this.plane, out);
  }

  /** Where on screen the point the view turns about lies: the cloth's point it looks at. */
  private pivot(): { x: number; y: number } | null {
    const camera = this.handlers.camera();
    camera.getWorldPosition(this.eye);
    camera.getWorldDirection(this.look);
    if (this.look.y > -1e-6) return null;
    this.eye.addScaledVector(this.look, -this.eye.y / this.look.y).project(camera);
    const rect = this.element.getBoundingClientRect();
    return {
      x: rect.left + ((this.eye.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - this.eye.y) / 2) * rect.height,
    };
  }

  /**
   * The angle a pointer moving between two screen points sweeps round the pivot, clockwise on
   * screen, or null when either point is too near the pivot for its direction to mean anything.
   */
  private sweep(x0: number, y0: number, x1: number, y1: number): number | null {
    const pivot = this.pivot();
    if (!pivot) return null;
    const ax = x0 - pivot.x;
    const ay = y0 - pivot.y;
    const bx = x1 - pivot.x;
    const by = y1 - pivot.y;
    if (Math.hypot(ax, ay) < PIVOT_CLEARANCE || Math.hypot(bx, by) < PIVOT_CLEARANCE) return null;
    return wrapAngle(Math.atan2(by, bx) - Math.atan2(ay, ax));
  }

  /** The table point under a screen point, or null if the ray misses the plane. */
  pointAt(clientX: number, clientY: number): { x: number; y: number } | null {
    if (!this.scenePoint(clientX, clientY, this.hit)) return null;
    const { W, L } = this.handlers.table();
    fromScene(this.hit.x, this.hit.y, this.hit.z, W, L, this.table);
    return { x: this.table.x, y: this.table.y };
  }

  /** What lies under a screen point: the cloth, a rail's corner or side, or the floor. */
  zoneAt(clientX: number, clientY: number): Zone {
    const p = this.pointAt(clientX, clientY);
    if (!p) return 'floor';
    const { W, L, railWidth } = this.handlers.table();
    const fromMiddleX = Math.abs(p.x - W / 2);
    const fromMiddleY = Math.abs(p.y - L / 2);
    const beyondX = fromMiddleX - W / 2;
    const beyondY = fromMiddleY - L / 2;
    if (beyondX <= 0 && beyondY <= 0) return 'cloth';
    if (beyondX > railWidth || beyondY > railWidth) return 'floor';
    return fromMiddleX > W / 2 - CORNER_REACH && fromMiddleY > L / 2 - CORNER_REACH
      ? 'corner'
      : 'edge';
  }

  private nearCueBall(clientX: number, clientY: number): boolean {
    const point = this.pointAt(clientX, clientY);
    const cue = this.handlers.cueBall();
    return (
      point !== null &&
      cue !== null &&
      this.handlers.canAct() &&
      this.handlers.inHand() &&
      Math.hypot(point.x - cue.x, point.y - cue.y) < 2.2 * R
    );
  }

  private readonly onDown = (event: PointerEvent) => {
    if (!this.enabled) return;
    const touch = event.pointerType !== 'mouse';
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, touch });
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser no longer knows (it lifted already): nothing to capture.
    }
    if (this.pointers.size === 2) {
      // A second finger: the gesture becomes the camera's.
      this.startGesture();
      return;
    }
    if (this.drag) return;
    this.dragPointer = event.pointerId;
    const { clientX: x, clientY: y } = event;
    if (event.button === 2) {
      this.drag = { kind: 'rotate', lastX: x, lastY: y };
    } else if (event.button === 1) {
      this.startPan(x, y);
    } else if (event.button === 0) {
      if (this.nearCueBall(x, y)) {
        this.drag = { kind: 'place' };
      } else {
        const zone = this.zoneAt(x, y);
        if (zone === 'cloth' && this.handlers.canAct()) {
          this.drag = { kind: 'aim' };
          const point = this.pointAt(x, y);
          if (point && !touch) this.handlers.aimAt(point.x, point.y);
        } else if (zone === 'edge') {
          this.startPan(x, y);
        } else {
          this.drag = { kind: 'rotate', lastX: x, lastY: y };
        }
      }
    }
    if (this.drag && event.button !== 0) event.preventDefault();
    this.updateCursor(x, y);
  };

  private startPan(clientX: number, clientY: number): void {
    const anchor = this.scenePoint(clientX, clientY);
    this.drag = anchor ? { kind: 'pan', anchor } : null;
  }

  private startGesture(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    if (this.drag?.kind === 'place') this.handlers.placed();
    this.drag = {
      kind: 'gesture',
      span: Math.hypot(a.x - b.x, a.y - b.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      centre: new Vector2((a.x + b.x) / 2, (a.y + b.y) / 2),
    };
  }

  private readonly onMove = (event: PointerEvent) => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) {
      if (event.pointerType === 'mouse' && event.buttons === 0) {
        this.updateCursor(event.clientX, event.clientY);
      }
      return;
    }
    const previous = { x: pointer.x, y: pointer.y };
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    const drag = this.drag;
    if (!drag) return;
    if (drag.kind === 'gesture') {
      this.updateGesture(drag);
      return;
    }
    if (event.pointerId !== this.dragPointer) return;
    switch (drag.kind) {
      case 'rotate': {
        const { lastX, lastY } = drag;
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        if (this.handlers.tilts()) {
          const dx = event.clientX - lastX;
          const dy = event.clientY - lastY;
          this.handlers.orbit(-dx * ROTATE_PER_PIXEL, dy * TILT_PER_PIXEL);
          return;
        }
        // The top view turns like a dial: by the angle the pointer sweeps round the point the
        // view turns about, so the table follows the hand all the way round, whichever corner it
        // holds (going by sideways movement alone, it turned back halfway round).
        const turn = this.sweep(lastX, lastY, event.clientX, event.clientY);
        if (turn !== null) this.handlers.orbit(turn, 0);
        return;
      }
      case 'pan': {
        const point = this.scenePoint(event.clientX, event.clientY);
        if (point) this.handlers.pan(drag.anchor.x - point.x, drag.anchor.z - point.z);
        return;
      }
      case 'place': {
        const point = this.pointAt(event.clientX, event.clientY);
        if (point) this.handlers.moveCueBall(point.x, point.y);
        return;
      }
      case 'aim': {
        if (!this.handlers.canAct()) return;
        if (!pointer.touch) {
          const point = this.pointAt(event.clientX, event.clientY);
          if (point) this.handlers.aimAt(point.x, point.y);
          return;
        }
        // A finger turns the aim by the angle it sweeps round the cue ball.
        const cue = this.handlers.cueBall();
        const from = this.pointAt(previous.x, previous.y);
        const to = this.pointAt(event.clientX, event.clientY);
        if (!cue || !from || !to) return;
        const a0 = Math.atan2(from.y - cue.y, from.x - cue.x);
        const a1 = Math.atan2(to.y - cue.y, to.x - cue.x);
        this.handlers.turnAim(wrapAngle(a1 - a0));
      }
    }
  };

  private updateGesture(drag: Extract<Drag, { kind: 'gesture' }>): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    const span = Math.hypot(a.x - b.x, a.y - b.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const centre = new Vector2((a.x + b.x) / 2, (a.y + b.y) / 2);
    if (drag.span > 0 && span > 0) this.handlers.zoom(drag.span / span);
    // Step by step, each step the short way round, so the line between the fingers crossing the
    // horizontal is not taken for a full turn. A clockwise twist turns the table clockwise.
    const tilts = this.handlers.tilts();
    const tilt = tilts ? (centre.y - drag.centre.y) * TILT_PER_PIXEL : 0;
    this.handlers.orbit(wrapAngle(angle - drag.angle), tilt);
    // Moving the fingers pans: the table point under their middle follows them (only sideways
    // where up and down tilts).
    const from = this.scenePoint(drag.centre.x, tilts ? centre.y : drag.centre.y);
    const to = this.scenePoint(centre.x, centre.y);
    if (from && to) this.handlers.pan(from.x - to.x, from.z - to.z);
    drag.span = span;
    drag.angle = angle;
    drag.centre = centre;
  }

  private readonly onUp = (event: PointerEvent) => {
    if (!this.pointers.delete(event.pointerId)) return;
    if (this.element.hasPointerCapture?.(event.pointerId)) {
      this.element.releasePointerCapture(event.pointerId);
    }
    const drag = this.drag;
    if (drag?.kind === 'gesture') {
      // The gesture ends when the fingers lift; a finger left behind does nothing until lifted.
      if (this.pointers.size === 0) this.drag = null;
      return;
    }
    if (event.pointerId === this.dragPointer) {
      if (drag?.kind === 'place') this.handlers.placed();
      this.drag = null;
      this.dragPointer = -1;
    }
    this.updateCursor(event.clientX, event.clientY);
  };

  private readonly onWheel = (event: WheelEvent) => {
    if (!this.enabled) return;
    event.preventDefault();
    const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    this.handlers.zoom(Math.exp(pixels * 0.0012));
  };

  private readonly onContextMenu = (event: Event) => {
    event.preventDefault();
  };

  /** The cursor for what a press here would do, or for the drag under way. */
  private updateCursor(clientX: number, clientY: number): void {
    let cursor = '';
    const drag = this.drag;
    if (drag?.kind === 'rotate') cursor = ROTATE_CURSOR;
    else if (drag?.kind === 'pan') cursor = PAN_CURSOR;
    else if (drag?.kind === 'place') cursor = 'grabbing';
    else if (drag?.kind === 'aim') cursor = 'crosshair';
    else if (!drag && this.enabled) {
      if (this.nearCueBall(clientX, clientY)) cursor = 'grab';
      else {
        const zone = this.zoneAt(clientX, clientY);
        if (zone === 'corner' || zone === 'floor') cursor = ROTATE_CURSOR;
        else if (zone === 'edge') cursor = PAN_CURSOR;
        else if (this.handlers.canAct()) cursor = 'crosshair';
        else cursor = ROTATE_CURSOR;
      }
    }
    if (this.element.style.cursor !== cursor) this.element.style.cursor = cursor;
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onDown);
    this.element.removeEventListener('pointermove', this.onMove);
    this.element.removeEventListener('pointerup', this.onUp);
    this.element.removeEventListener('pointercancel', this.onUp);
    this.element.removeEventListener('wheel', this.onWheel);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
  }
}

/** The same angle within half a turn of zero. */
function wrapAngle(angle: number): number {
  return angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI));
}
