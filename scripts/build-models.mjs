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

// Rebuilds the models with Blender, in order:
//   inputs    the table geometry, the cue's parts and the ball textures, from src/ (Node)
//   build     blender/pool.blend: both tables, the cue, the ball set
//   export    public/models/table-9ft.glb, table-7ft.glb, cue.glb
//   previews  the reference renders in blender/renders/ (metadata stripped: they are published)
// Usage: npm run models [-- inputs|build|export|previews ...]   (default: all four)
// Set BLENDER to the Blender executable if it is not in its usual place.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripMetadata } from './image-metadata.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const defaultBlender = {
  win32: 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
  darwin: '/Applications/Blender.app/Contents/MacOS/Blender',
};
const blender = process.env.BLENDER ?? defaultBlender[process.platform] ?? 'blender';
const blend = join(root, 'blender', 'pool.blend');
const order = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['inputs', 'build', 'export', 'previews'];

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root });
  if (result.error) console.error(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function blenderScript(file, script) {
  const args = ['--background', ...(file ? [file] : []), '--factory-startup'];
  run(blender, [
    ...args,
    '--python-exit-code',
    '1',
    '--python',
    join(root, 'blender', 'scripts', script),
  ]);
}

for (const step of order) {
  console.log(`\n== ${step}`);
  if (step === 'inputs') {
    for (const script of ['export-table.ts', 'export-cue.ts', 'export-ball-textures.ts']) {
      run(process.execPath, [join(root, 'scripts', script)]);
    }
  } else if (step === 'build') {
    blenderScript(null, 'build.py');
  } else if (step === 'export') {
    blenderScript(blend, 'export_glb.py');
  } else if (step === 'previews') {
    blenderScript(blend, 'render_previews.py');
    const renders = join(root, 'blender', 'renders');
    for (const name of readdirSync(renders).filter((n) => /\.(jpe?g|png)$/i.test(n))) {
      const file = join(renders, name);
      writeFileSync(file, stripMetadata(readFileSync(file)));
    }
  } else {
    console.error(`unknown step "${step}"; use inputs, build, export or previews`);
    process.exit(1);
  }
}
