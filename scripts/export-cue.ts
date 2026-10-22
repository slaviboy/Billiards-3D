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

// Writes the cue's parts for the Blender script that turns them: blender/cue-spec.json.
// Usage: node scripts/export-cue.ts

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CUE_LENGTH, CUE_PARTS, TIP_RADIUS } from '../src/cue/spec.ts';

const file = join(import.meta.dirname, '..', 'blender', 'cue-spec.json');
const spec = { units: 'metres', length: CUE_LENGTH, tipRadius: TIP_RADIUS, parts: CUE_PARTS };
writeFileSync(file, `${JSON.stringify(spec, null, 1)}\n`);
console.log('wrote blender/cue-spec.json');
