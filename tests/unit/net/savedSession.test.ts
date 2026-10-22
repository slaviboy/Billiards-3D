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

import { describe, expect, it } from 'vitest';
import { POOL_CODEC, setupFor, syncMessage } from '../../../src/game/gameMessages.ts';
import { MatchController } from '../../../src/game/MatchController.ts';
import { createInvite } from '../../../src/net/protocol.ts';
import { parseSaved } from '../../../src/net/savedSession.ts';
import { terms } from '../../support/onlineSides.ts';

const SAMPLE_ID = 'abcdefghijklmnopqrstuv';

describe('parseSaved', () => {
  const match = new MatchController(setupFor(terms('Ben')));
  const good = {
    invite: createInvite(),
    role: 'guest',
    token: SAMPLE_ID,
    name: 'Ben',
    friendName: 'Ana',
    terms: terms('Ben'),
    state: syncMessage(match.current, match.hash()),
  };

  it('reads back a saved game, with the game’s own checks for its terms and table', () => {
    const parsed = parseSaved(JSON.parse(JSON.stringify(good)), POOL_CODEC);
    expect(parsed).toEqual(JSON.parse(JSON.stringify(good)));
    expect(parseSaved({ ...good, terms: null, state: null }, POOL_CODEC)).toMatchObject({
      terms: null,
      state: null,
    });
  });

  it('treats anything malformed as nothing', () => {
    for (const patch of [
      { role: 'admin' },
      { token: 'x' },
      { token: null },
      { name: 7 },
      { invite: { secret: 's' } },
      { terms: { ...terms('Ben'), race: 0 } },
      { terms: 'race to 3' },
      { state: { ...good.state, balls: [] } },
      { state: { t: 'shot' } },
      { state: { t: 'timeout', n: 0 } },
    ]) {
      expect(parseSaved({ ...good, ...patch }, POOL_CODEC), JSON.stringify(patch)).toBeNull();
    }
    expect(parseSaved(null, POOL_CODEC)).toBeNull();
    expect(parseSaved('saved', POOL_CODEC)).toBeNull();
  });

  it('cleans the names it reads back', () => {
    const parsed = parseSaved({ ...good, name: ' Ben‮ ', friendName: '' }, POOL_CODEC);
    expect(parsed).toMatchObject({ name: 'Ben', friendName: 'Friend' });
  });
});
