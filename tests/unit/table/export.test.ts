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

// The geometry files the Blender model is built from are the ones the simulation's table makes:
// a change to src/table/ without re-running scripts/export-table.ts fails here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TABLE_SIZES } from '../../../src/table/spec.ts';
import { tableGeometryJson } from '../../../src/table/serialize.ts';

const root = join(import.meta.dirname, '..', '..', '..');

describe('exported table geometry', () => {
  it.each(TABLE_SIZES)('blender/table-geometry-%s.json is up to date', (size) => {
    const file = readFileSync(join(root, 'blender', `table-geometry-${size}.json`), 'utf8');
    expect(JSON.parse(file)).toEqual(JSON.parse(JSON.stringify(tableGeometryJson(size))));
  });
});
