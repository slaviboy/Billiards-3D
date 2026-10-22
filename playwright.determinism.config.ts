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

// Cross-engine determinism: the simulation in Chromium, Firefox and WebKit against Node's results.
// It loads the sources through the Vite dev server, so it needs no build.
// Run: npx playwright test -c playwright.determinism.config.ts

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/determinism',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4175/' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npx vite --port 4175 --strictPort',
    url: 'http://localhost:4175/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
