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

// Node computes the determinism suite exactly as recorded. A change here means the physics changed:
// regenerate with scripts/determinism-hashes.ts if that was the intent.

import { describe, expect, it } from 'vitest';
import { determinismSuite } from '../../../src/physics/selfcheck.ts';
import { buildTable } from '../../../src/table/geometry.ts';
import { TABLE_SIZES, tableSpec } from '../../../src/table/spec.ts';
import expected from '../../fixtures/determinism-hashes.json' with { type: 'json' };

describe('determinism suite', () => {
  it.each(TABLE_SIZES)('reproduces the recorded outcomes on the %s table', (size) => {
    expect(determinismSuite(buildTable(tableSpec(size)).physics)).toEqual(
      (expected as Record<string, string[]>)[size],
    );
  });
});
