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

// Writes the outcomes of the determinism suite (src/physics/selfcheck.ts) as Node computes them,
// for both tables: tests/fixtures/determinism-hashes.json. Every engine must reproduce them. Run it
// after an intended change to the physics, and say so in the commit.
// Usage: node scripts/determinism-hashes.ts

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { determinismSuite } from '../src/physics/selfcheck.ts';
import { buildTable } from '../src/table/geometry.ts';
import { TABLE_SIZES, tableSpec } from '../src/table/spec.ts';

const result: Record<string, string[]> = {};
for (const size of TABLE_SIZES)
  result[size] = determinismSuite(buildTable(tableSpec(size)).physics);
const file = join(import.meta.dirname, '..', 'tests', 'fixtures', 'determinism-hashes.json');
writeFileSync(file, `${JSON.stringify(result, null, 1)}\n`);
console.log(`wrote ${Object.values(result).flat().length} outcomes`);
