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

// The same seeded shots in Chromium, Firefox and WebKit must end exactly as they do in Node: online,
// each player's browser simulates every shot, so any difference would split the game in two.
// Run: npx playwright test -c playwright.determinism.config.ts

import { expect, test } from '@playwright/test';
import expected from '../fixtures/determinism-hashes.json' with { type: 'json' };

test('simulates the suite exactly as Node does', async ({ page }) => {
  await page.goto('./');
  const outcome = await page.evaluate(async () => {
    const { determinismSuite } = await import('/src/physics/selfcheck.ts');
    const { buildTable } = await import('/src/table/geometry.ts');
    const { tableSpec } = await import('/src/table/spec.ts');
    return {
      '7ft': determinismSuite(buildTable(tableSpec('7ft')).physics),
      '9ft': determinismSuite(buildTable(tableSpec('9ft')).physics),
    };
  });
  expect(outcome).toEqual(expected);
});
