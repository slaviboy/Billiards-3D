# Performance

What a game costs, measured, and what keeps it smooth on slower devices.

## What it costs

- **Simulation.** A full break with 15 balls takes about 3 ms in Node on a desktop computer: over
  50 breaks, mean 3.0 ms, median 2.4 ms, slowest 13.3 ms, with 154 events on average and 931 at
  most (`node scripts/physics-bench.ts`). A shot is simulated in full before it plays, on the main
  thread; at these times a worker would not be noticed, so there is none.
- **Download.** The game is one script of about 1 MB (309 kB compressed), mostly three.js, a 27 kB
  stylesheet, and the models: 450 kB for the 9-ft table, 443 kB for the 7-ft one (only the table
  in use is loaded) and 74 kB for the cue. The balls are drawn by a shader and need no textures.
- **Drawing.** Frames are drawn only when something moves: a table at rest costs nothing.

## Frame rate

Frame times while a full break plays (7.9 s), timed with `requestAnimationFrame` in Chromium on
the development computer's GPU (Radeon RX 9070 XT, Direct3D 11), vsync on:

| Screen | Frames | Over 20 ms | Median | Slowest |
|---|---|---|---|---|
| 1280×800, high quality | 470 | 0 | 16.7 ms | 16.8 ms |
| 1920×1080, high quality | 470 | 0 | 16.7 ms | 16.8 ms |
| phone, 390×844 at 3× pixel density, high quality | 470 | 0 | 16.7 ms | 16.8 ms |
| the same, with the CPU slowed fourfold | 469 | 1 | 16.7 ms | 33.4 ms |
| the same, low quality | 469 | 1 | 16.7 ms | 33.2 ms |

The phone rows emulate a phone's screen and a slow processor on a desktop GPU; **no real phone has
been measured.** A phone's GPU is far weaker, which is what the automatic quality below is for.

## Staying smooth on slow devices

- **Low quality** (Settings → Graphics → Low, or `?quality=low`) turns shadows and antialiasing off
  and draws one pixel per CSS pixel. Automated browsers start in it.
- **Automatic quality** (the default) starts high and watches the frames that animate (the median
  of the latest nine; idle frames are left out). Below 40 frames a second it drops, once, to the low
  quality and says so. With Chromium's software renderer and the CPU slowed fourfold, a break ran
  at 30 frames a second and the graphics were lowered within the first second; on the GPU above
  they never were.
- **Playback speed** (Settings → Shot playback) shortens shots without changing them: the balls'
  states are sampled from the simulation at any time, so a slow frame never changes where they go.
