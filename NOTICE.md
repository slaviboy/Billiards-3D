# Third-party notices

Pool is distributed under the GNU General Public License version 3 or later (see
[LICENSE](LICENSE)). It includes or depends on the following software.

## pooltool — Apache-2.0

The billiards physics in `src/physics/` is translated into TypeScript from
[pooltool](https://github.com/ekiefl/pooltool) by Evan Kiefl and contributors, version 0.6.0
(commit `869fdd96b8c618d0df34112defb1bce7faf37c97`), licensed under the Apache License 2.0. The
licence text is in [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt).

The translation is changed from the original: every file that carries translated code says so
below its header and names the pooltool file it comes from. The main changes are that the
quartic solver is replaced by our own root isolation, that only deterministic arithmetic is used
(so two browsers compute the same shot to the last bit), and that angles are carried as unit
vectors instead of trigonometry. pooltool itself is not shipped; its Python code runs only on a
developer's machine, to produce the reference results the tests compare against
(`tools/pooltool-fixtures/`).

Apache-2.0 code may be included in a GPL-3.0 work; the combined work is distributed under the
GPL-3.0, and the Apache-2.0 notice requirements above are kept.

## three.js — MIT

Copyright © 2010–2026 three.js authors. https://github.com/mrdoob/three.js — MIT License.

## Trystero — MIT

Copyright © 2021 Dan Motzenbecker. https://github.com/dmotz/trystero — MIT License. It connects
two players' browsers for online games: it finds the other player through public Nostr relays and
then opens a direct WebRTC connection.

## noble-secp256k1 — MIT

Copyright © 2019 Paul Miller. https://github.com/paulmillr/noble-secp256k1 — MIT License. Trystero
uses it to sign its Nostr messages.

## QR Code Generator — MIT

Copyright © 2009 Kazuhiko Arase. https://github.com/kazuhikoarase/qrcode-generator — MIT License. It
draws the invitation link as a QR code, in the browser. The word "QR Code" is a registered trademark
of DENSO WAVE INCORPORATED.

## Shared code

Parts of the interface, the online layer and the tooling come from the author's own chess game,
Grandmaster 3D (https://github.com/slaviboy/Grandmaster-3D), under the same licence.

## Assets

The table, cue and ball set were modelled for this project with the Blender scripts in
`blender/scripts/`, from published equipment specifications. The ball markings, cloth and wood are
generated procedurally. The icons, the rolling sound and the game's notes (synthesised with Web
Audio) are original. No third-party models, textures or fonts are included.

## Sound effects — Pixabay Content License

The hits in `public/sounds/` are short excerpts cut from recordings published on Pixabay under
the Pixabay Content License (https://pixabay.com/service/license-summary/), which allows them to be
used and adapted for free, without attribution; they are credited here all the same. Each excerpt
is a single hit, cut out, aligned to its attack, faded, normalised and re-encoded for the game
(`docs/sounds.md` lists every cut). These files are under the Pixabay Content License, not the
GPL.

- *Billiard Sound 01*, *02*, *03*, *05* and *6*, *Billiard Hole*, *Billiard Hole 2* and *Billiard
  Setup Sound*, recorded by Alex_Jauk:
  https://pixabay.com/sound-effects/film-special-effects-billiard-sound-01-288421/,
  https://pixabay.com/sound-effects/film-special-effects-billiard-sound-02-288423/,
  https://pixabay.com/sound-effects/film-special-effects-billiard-sound-03-288424/,
  https://pixabay.com/sound-effects/film-special-effects-billiard-sound-05-288416/,
  https://pixabay.com/sound-effects/film-special-effects-billiard-sound-6-288417/,
  https://pixabay.com/sound-effects/film-special-effects-billiard-hole-288419/,
  https://pixabay.com/sound-effects/film-special-effects-billiard-hole-2-288420/ and
  https://pixabay.com/sound-effects/film-special-effects-billiard-setup-sound-288418/
- *pool_break*, published by freesound_community:
  https://pixabay.com/sound-effects/film-special-effects-pool-break-105353/
