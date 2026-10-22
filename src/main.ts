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

import './styles/base.css';
import { App } from './app/App.ts';
import { installDebugHook } from './app/debugHook.ts';
import { isTableSize } from './table/spec.ts';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app');
const params = new URLSearchParams(location.search);
const size = params.get('table');
// Automated browsers get no shadows or antialiasing (fast enough in software), unless ?quality=
// says otherwise.
const asked = params.get('quality');
const quality = asked === 'low' || asked === 'high' ? asked : navigator.webdriver ? 'low' : 'high';
const app = new App(root, import.meta.env.BASE_URL, isTableSize(size) ? size : '9ft', quality);
installDebugHook(app);
app.ready
  .then(() => {
    root.dataset.ready = 'true';
  })
  .catch((error: Error) => {
    console.error(error);
    const message = document.createElement('div');
    message.className = 'load-error';
    message.textContent = `The game could not start: ${error.message}`;
    document.body.append(message);
  });

// Practice controls until the interface arrives: arrows aim (Shift: finely), W/S power, I/J/K/L
// tip, Space shoots, V switches the view, R racks again.
window.addEventListener('keydown', (event) => {
  const aim = app.aim;
  const step = event.shiftKey ? 0.002 : 0.02;
  switch (event.key) {
    case 'ArrowLeft':
      aim.heading += step;
      break;
    case 'ArrowRight':
      aim.heading -= step;
      break;
    case 'w':
      aim.speed = Math.min(8, aim.speed + 0.25);
      break;
    case 's':
      aim.speed = Math.max(0.1, aim.speed - 0.25);
      break;
    case 'i':
      aim.b = Math.min(0.5, aim.b + 0.05);
      break;
    case 'k':
      aim.b = Math.max(-0.5, aim.b - 0.05);
      break;
    case 'j':
      aim.a = Math.min(0.5, aim.a + 0.05);
      break;
    case 'l':
      aim.a = Math.max(-0.5, aim.a - 0.05);
      break;
    case ' ':
      void app.shoot();
      return;
    case 'v':
      app.setView(app.rig.view === '3d' ? 'top' : '3d');
      return;
    case 'r':
      app.rack(String(Date.now()));
      return;
    default:
      return;
  }
  app.updateCue();
});
