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
import { PoolScene } from './scene/PoolScene.ts';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app');
const scene = new PoolScene(root);
root.dataset.ready = 'true';
void scene;
