# Sounds

What each contact of a shot sounds like, and where the sounds come from.

## How a shot is heard

The simulation reports every contact with its impact speed (`src/physics/simulate.ts`).
`src/audio/shotAudio.ts` turns each into a sound and a loudness: silent below 1.5 cm/s, then
rising on a logarithmic curve to full at 7 m/s for the cue tip, 6 for ball on ball, 4 for a
cushion, 3.5 for a jaw and 3 for a ball dropping. Contacts of one kind within 12 ms of each other
are heard as one, and at most 14 sounds ring at once, so a break stays a clatter rather than a
roar. Each sound is scheduled at its contact's own time within the frame.

`src/audio/SoundManager.ts` plays a recorded hit for each:

| Contact | Clips | How the loudness is used |
|---|---|---|
| cue tip on the cue ball | `cue-1`–`cue-3`; `cue-power` from 85 % | gain |
| ball on ball | `ball-1`–`ball-5`; `ball-hard` (a break's crack) from 82 % | gain, and a low-pass from 1.8 to 18 kHz: soft clicks are darker |
| cushion | `cushion-1`–`cushion-4` | gain |
| pocket jaw | `jaw-1`, or `cushion-3`/`cushion-4`, 15 % higher | gain |
| ball into a pocket | `pocket-1`, `pocket-2` | gain |
| a new rack | `rack` | — |

A clip is picked at random from its set and played a few per cent higher or lower, so that repeats
never sound alike. Until the clips have loaded (they load when audio starts, after the first click
or key press), or if one cannot be loaded, a synthesised hit is played instead. The rolling hum and
the game's notes (a foul, a rack or a match won, a pocket called) are always synthesised.

A full break rendered offline in Chromium with these clips peaks at 0.86 of full scale at full
volume, without clipping.

## Where the clips come from

The clips are cut from recordings on Pixabay, under the Pixabay Content License (see
[NOTICE.md](../NOTICE.md)). Nineteen results of a search for "billiards" were looked at; thirteen
were downloaded and analysed in Chromium: where each hit starts, its peak, its brightness (the
spectral centroid of its first 25 ms), how long it rings, and its share of energy below 400 Hz.
That separated the dull tock of a cue tip (400–1000 Hz), the bright click of two balls (2700–3300
Hz, almost no low end, falling 20 dB within 2–70 ms), the low thump of a cushion and the rattle of
a ball into a pocket. Hits that were sustained noise rather than a single click, double hits, and
two recordings that looked synthetic (a 120 Hz rumble, then a 14 ms hit with nothing below 400 Hz)
were left out.

Each clip below was cut from its source between the times given, then aligned to start 2 ms before
its first sample above 30 % of its peak (not `rack`, kept whole), faded in over 1 ms and out over
20 ms, normalised to a peak of 0.89, and encoded as 44.1 kHz mono MP3 at 96 kbps, without tags.

| Clip | Source | Cut (s) |
|---|---|---|
| `cue-1` | Billiard Sound 01 (288421) | 0.454–0.590 |
| `cue-2` | Billiard Sound 03 (288424) | 0.083–0.255 |
| `cue-3` | Billiard Sound 05 (288416) | 0.248–0.384 |
| `cue-power` | pool_break (105353) | 0.576–0.800 |
| `ball-1` | Billiard Sound 6 (288417) | 0.609–0.800 |
| `ball-2` | pool_break (105353) | 1.650–1.840 |
| `ball-3` | Billiard Sound 03 (288424) | 1.097–1.190 |
| `ball-4` | Billiard Sound 02 (288423) | 1.493–1.680 |
| `ball-5` | Billiard Sound 02 (288423) | 1.147–1.244 |
| `ball-hard` | pool_break (105353) | 0.856–0.977 |
| `cushion-1` | Billiard Sound 02 (288423) | 0.925–1.150 |
| `cushion-2` | Billiard Sound 05 (288416) | 1.268–1.550 |
| `cushion-3` | Billiard Sound 03 (288424) | 0.786–1.050 |
| `cushion-4` | Billiard Sound 02 (288423) | 1.239–1.450 |
| `jaw-1` | pool_break (105353) | 1.335–1.550 |
| `pocket-1` | Billiard Hole (288419) | 0.060–0.840 |
| `pocket-2` | Billiard Hole 2 (288420) | 0.160–0.550 |
| `rack` | Billiard Setup Sound (288418) | 0.000–1.360 |

The eighteen clips take 100 kB together. The choice was made from measurements and waveforms, not
by ear; a listening pass on real speakers may well swap some of them.
