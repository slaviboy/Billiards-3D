# Pool

A realistic 3D 8-ball game for the browser: three.js scene, a table, cue and balls modelled in
Blender from published specifications, an event-based billiards simulation translated from pooltool,
the WPA 8-ball rules, and online play with a friend over WebRTC. Read `README.md` for features and
commands, and the documents in `docs/` for the physics, rules, table specification and protocol.

## Commit rules

These are enforced by `.githooks/`, enabled with `git config core.hooksPath .githooks`.

- **Author.** Every commit is authored by `slaviboy <slavi94slavi94@gmail.com>`. The repository's
  local git config sets this, and `pre-commit` rejects anything else.
- **No co-author trailers.** `commit-msg` strips `Co-Authored-By:` lines. Do not add them.
- **License headers.** The project is GPL-3.0-or-later. Every hand-written source file starts with
  the GPL header (`Copyright (C) 2026 Stanislav Georgiev`, `https://github.com/slaviboy`, GNU
  General Public License). `tests/architecture/licenseHeaders.test.ts` enforces this. Files with
  code translated from pooltool also say so, and name the pooltool file, right below the header.
- **No secrets.** `tests/architecture/secrets.test.ts` scans tracked files.
- **Nothing private.** The repository is public. No e-mail address but the author's, no path of
  the computer the work is done on, no copyright holder who is not credited, and no metadata in
  images (strip it with `node scripts/image-metadata.ts strip <files>`). This applies inside
  binary files too: Blender writes paths into renders and into the .blend, so save the .blend
  through `common.save_blend`. `tests/architecture/identity.test.ts` enforces this, and
  `npm run audit` checks every commit in the history (the deploy workflow runs it). The rules live
  in `scripts/public-safety.ts`.
- **Product naming.** The product is Pool. The commercial mobile game whose play inspired it is
  never named in tracked files: not in source, comments, identifiers, UI strings, documentation or
  commit messages. Write "the reference" instead, and always write the discipline as "8-ball", with
  a hyphen. `tests/architecture/branding.test.ts` enforces this, also inside images and models.
  Reference photographs stay in `docs/reference/`, which is gitignored.
- **Messages.** Use conventional prefixes (`feat:`, `fix:`, `perf:`, `refactor:`, `test:`, `docs:`,
  `chore:`, `ci:`) in the imperative mood, with a body that says what changed and why. Make one
  meaningful change per commit, and commit after every one. Never push; the owner pushes.

## Commands

```
npm run dev          # Vite dev server
npm run build        # type-check, then production build
npm test             # Vitest: unit + architecture
npm run test:e2e     # Playwright against the production build (ask before running all of it)
npm run lint         # ESLint
npm run format:check # Prettier
npm run audit        # the whole history: authors, messages, every file version (public safety)
npm run audit:dist   # the built site: no source maps, local addresses or private data
```

**Run end-to-end tests one file at a time** (`npx playwright test tests/e2e/boot.spec.ts`). The
machine is shared with other work: never start the whole suite, or a second run, without asking.

## Rules that keep the game correct

- **Online, each side referees what it receives.** Everything from the other player passes
  `PeerGuard` (size, rate, shape), `OnlineSession` (who may say what, when) and the match controller
  (whose turn, which shot, legal values and placement). Each side simulates the shot and judges the
  rules itself; never trust the other side's results or media state. A rule break forfeits and
  disconnects. Only `src/net/PeerLink.ts` touches Trystero or a peer connection; never put network
  objects on `window` or log addresses, candidates or SDP. Every online game starts with the 18+
  and IP warning, its box unticked, before anything connects.
