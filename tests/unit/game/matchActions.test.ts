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

// What online play hears from the match: every shot, decision and time-out as it is made, with
// who made it and the table it led to; and a match ended for one player whatever the score.

import { describe, expect, it } from 'vitest';
import {
  MatchController,
  type MatchAction,
  type MatchSetup,
} from '../../../src/game/MatchController.ts';
import { encodeShot } from '../../../src/game/shotCodec.ts';

const setup: MatchSetup = {
  mode: 'online',
  size: '9ft',
  race: 3,
  shotClock: 30,
  names: ['Ana', 'Ben'],
  seed: 'actions',
  firstBreak: 1,
};

function heard() {
  const match = new MatchController(setup);
  const actions: MatchAction[] = [];
  const off = match.onAction((a) => actions.push(a));
  return { match, actions, off };
}

describe('match actions', () => {
  it('reports a shot with its shooter, index, inputs and the table it led to', () => {
    const { match, actions } = heard();
    const code = encodeShot(Math.PI / 2, 0, 6, 0, 0);
    const result = match.shoot(code, { pocket: null, safety: false }, { x: 63500, y: 40000 });
    expect(actions).toEqual([
      {
        kind: 'shot',
        seat: 1,
        n: 0,
        code,
        intent: { pocket: null, safety: false },
        placement: { x: 63500, y: 40000 },
        hash: match.hash(),
        duration: result.timeline.duration,
      },
    ]);
  });

  it('reports a time-out and a decision with who made them', () => {
    const { match, actions } = heard();
    match.timeOut();
    expect(actions.at(-1)).toEqual({ kind: 'timeout', seat: 1, n: 0 });
    // The time-out on the break passed it to Ana; a soft break of hers is illegal.
    const soft = encodeShot(Math.PI / 2, 0, 0.3, 0, 0);
    match.shoot(soft, { pocket: null, safety: false });
    expect(match.current.rack).toMatchObject({ phase: 'decision', turn: 1 });
    match.decide('accept');
    expect(actions.at(-1)).toEqual({ kind: 'decide', seat: 1, n: 1, choice: 'accept' });
  });

  it('stops reporting once the listener is gone, and a failing listener undoes nothing', () => {
    const { match, actions, off } = heard();
    off();
    match.onAction(() => {
      throw new Error('listener trouble');
    });
    const quiet = console.error;
    console.error = () => undefined;
    try {
      match.timeOut();
    } finally {
      console.error = quiet;
    }
    expect(actions).toEqual([]);
    expect(match.current.rack.breaker).toBe(0);
  });

  it('awards the match to one player whatever the score, once', () => {
    const { match } = heard();
    match.award(0);
    expect(match.current).toMatchObject({ winner: 0, score: [0, 0] });
    expect(match.current.rack).toMatchObject({ phase: 'over', winner: 0, end: 'concede' });
    match.award(1);
    expect(match.current.winner).toBe(0);
  });
});
