# Visual and technical research

What the table, balls, cue, physics and rules of Pool are based on, where each number comes from,
and which numbers are our own estimates. Gathered on 2026-10-22.

Legend: **[S]** taken directly from the cited document, read in full; **[s]** from a secondary
source (a search result, a forum post, a retailer listing whose page could not be opened);
**[A]** our approximation or choice, with the reason.

## 1. Sources

| # | Source | What it gave | How it was read |
|---|---|---|---|
| 1 | WPA, *Recommended Equipment Specifications* (effective November 2001), https://wpapool.com/wp-content/uploads/2024/01/RECOMMENDED-EQUIPMENT-SPECIFICATIONS.pdf | Table, cushion, pocket, cloth, light, ball and cue specifications | The whole PDF (7 pages) |
| 2 | WPA, *Rules of Play* (effective 2026-10-21), https://wpapool.com/wp-content/uploads/2026/10/WPA-Rules-2026-10-21-211.pdf | General rules, definitions, fouls, 8-ball | Sections 1–4 read in full; paraphrased in `docs/rules.md`, never copied |
| 3 | pooltool v0.6.0 (commit `869fdd96b8c618d0df34112defb1bce7faf37c97`), https://github.com/ekiefl/pooltool — `pooltool/objects/ball/params.py`, `pooltool/objects/table/specs.py` and the physics modules | Ball parameters, the 7-ft pocket table geometry, the event-based simulation model | Source files at the tag |
| 4 | pooltool theory notes, https://ekiefl.github.io/2020/04/24/pooltool-theory/ | Sliding, rolling and spinning equations; cushion-model survey (Han 2005, Mathavan 2010, Marlow) | Read |
| 5 | Dr. Dave Alciatore, technical proofs and articles, https://billiards.colostate.edu (e.g. `technical_proofs/new/TP_A-5.pdf`, `TP_B-8.pdf`, `bd_articles/2005/april05.pdf`) | Ball-ball restitution and friction, ball-cloth friction | Through search results; the "physical properties" FAQ page refuses automated readers (HTTP 403) |
| 6 | Wikipedia, *Cue stick*, https://en.wikipedia.org/wiki/Cue_stick | Cue length, weight, tip, ferrule, taper, joint | Read |
| 7 | AZBilliards forum threads on table sizes, e.g. https://forums.azbilliards.com/goto/post?id=2191806 and https://forums.azbilliards.com/goto/post?id=4579221; https://www.dimensions.com/element/7-foot-billiards-pool-table | 7-ft bar-box playing surface | Search results |
| 8 | Retailer listings for the Brunswick Gold Crown VI (billiardfactory.com, johnsonfitness.com) | Overall size, slate and rail heights, leg positions of a 9-ft table | Search-result text only; both pages refuse automated readers (HTTP 403) |
| 9 | Wikimedia Commons photographs (section 7) | Look of balls, cloth, rails, pockets, legs | Downloaded to `docs/reference/` (gitignored) and viewed |

## 2. The table

### 2.1 Chosen standard

Two tables, both built from one parametric description (`src/table/spec.ts`), so that the
simulation, the 3D model and the rules always agree:

- **9-ft regulation (WPA).** The tournament table of source 1. The default.
- **7-ft bar box.** The common bar and home table, offered because balls look larger on a phone.
  The WPA does not specify a 7-ft table; its pocket and cushion details follow the WPA ranges.

"9-ft" and "7-ft" name the table, not a measurement: the dimensions below are the **playing
surface measured between the cushion noses**, not the outside of the frame.

### 2.2 Playing surface and frame

| Item | Value | Status |
|---|---|---|
| 9-ft playing surface | 100 × 50 in (+1/8 in) = 2.54 × 1.27 m | [S] 1 §5 |
| 8-ft playing surface (not built) | 92 × 46 in = 2.3368 × 1.1684 m | [S] 1 §5 |
| 7-ft playing surface | 78 × 39 in = 1.9812 × 0.9906 m | [s] 7 (also pooltool's 7-ft table, source 3). Some makers build 80 × 40 in. |
| Bed height (floor to cloth) | 29¼–31 in | [S] 1 §2; we use 30 in = 0.762 m [A] |
| Slate | at least 1 in, three equal pieces on tournament tables | [S] 1 §4 |
| Rail width, including cushion | 4–7½ in | [S] 1 §6; we use 5½ in for the 9-ft and 5 in for the 7-ft [A] |
| Rail top above the bed | about 1¾ in (rails 32.25 in and slate 30.5 in above the floor on a Gold Crown VI) | [s] 8; we use 1¾ in [A] |
| Overall size of a commercial 9-ft table | about 114.6 × 64.75 in (Gold Crown VI) | [s] 8 — consistent with 100 × 50 in plus about 7.3 in of rail on each side |
| Leg (leveller) centres | about 79.25 × 46.125 in on a Gold Crown VI | [s] 8; used only for proportion [A] |

### 2.3 Cushions

| Item | Value | Status |
|---|---|---|
| Profile | triangular rubber, cloth-covered | [S] 1 §7 |
| Width, featherstrip to nose | 1⅞–2 in (the PDF prints "[4.76 cm] and 2 inches [5.40 cm]"; 2 in is 5.08 cm, so the 5.40 is a misprint) | [S] 1 §7; we use 2 in [A] |
| Nose height above the bed | 63½ % of ball diameter (62½–64½ %) → 1.429 in = 36.29 mm | [S] 1 §7 |
| Speed | a centre-ball stroke from the head spot through the foot spot travels 4–4½ table lengths | [S] 1 §8 — used to tune the cushion restitution check in the physics tests |
| Rubber profile names (K66, K55) | K66 is the usual home and commercial profile | [s] forum and retailer results; not needed for the model |

### 2.4 Pockets

| Item | Value | Status |
|---|---|---|
| Corner mouth (lip to lip, where the nose changes direction) | 4.5–4.625 in | [S] 1 §9; we use 4.5625 in [A] |
| Side mouth | 5–5.125 in (traditionally ½ in wider than the corners) | [S] 1 §9; we use 5.0625 in [A] |
| Horizontal cut angle of the facings | corner 142° (+1), side 104° (+1), the same on both sides | [S] 1 §9 |
| Vertical pocket angle (back draft) | 12–15° | [S] 1 §9; we use 13.5° (visual only) [A] |
| Shelf (mouth line to the slate cut) | corner 1–2¼ in, side 0–0.375 in | [S] 1 §9; starting values 1.5 / 0.1875 in, calibrated by tests within the range [A] |
| Facings | hard rubber, 1/16–¼ in, ⅛ in preferred | [S] 1 §9; ⅛ in (visual only) [A] |
| Liners | plastic, rubber or leather; the upper inner wall turns balls downwards | [S] 1 §10 |
| Drop pockets | baskets for at least 6 balls | [S] 1 §11 — the model uses drop pockets with cups, as in photo 7.4 |
| Jaw rounding and pocket (drop) circle radius | not specified by the WPA | [A] calibrated by tests: a slow ball along the rail and a straight-in ball drop, a ball hitting the jaw stays out |

### 2.5 Sights and markings

| Item | Value | Status |
|---|---|---|
| Sights | 18 (or 17 and a name plate), flush in the rail cap | [S] 1 §6 |
| Spacing | 12½ in on a 9-ft table; ⅛ of the length and ¼ of the width, nose to nose | [S] 1 §6 and 2 §2.1; 9.75 in on the 7-ft table [A] (same rule) |
| Distance from the nose | 3 11/16 in to the sight centre | [S] 1 §6 |
| Shape | round 7/16–½ in, or diamond 1 × 7/16 to 1¼ × ⅝ in | [S] 1 §6; we use round ½ in mother-of-pearl dots [A] |
| Strings and spots | Head String bounds the quarter nearest the head rail; Foot Spot where the Foot String meets the Long String | [S] 2 §2.1 |

### 2.6 Cloth and light

| Item | Value | Status |
|---|---|---|
| Cloth | nap-free worsted wool (80–85 % wool, 15–20 % nylon; 100 % wool preferred) | [S] 1 §12 |
| Colours allowed in WPA play | yellow-green, blue-green, electric blue | [S] 1 §12 — we offer a blue-green (default), a yellow-green and an electric blue [A] |
| Light on bed and rails | at least 520 lux everywhere, even across the table | [S] 1 §15 |
| Fixture height | at least 40 in above the bed if movable, 65 in if fixed | [S] 1 §15; the rendered lamp hangs 40 in above the bed [A] |

## 3. Balls

| Item | Value | Status |
|---|---|---|
| Material | cast phenolic resin | [S] 1 §16 |
| Diameter | 2¼ in (+0.005 in) = 57.15 mm | [S] 1 §16; R = 0.028575 m, as in pooltool [S] 3 |
| Mass | 5½–6 oz = 156–170 g | [S] 1 §16; m = 0.170097 kg, as in pooltool [S] 3 |
| Set | a white cue ball and 15 numbered object balls | [S] 1 §16 |
| Solids | 1 yellow, 2 blue, 3 red, 4 purple, 5 orange, 6 green, 7 maroon, 8 black | [S] 1 §16 |
| Stripes | white with a centred band: 9 yellow, 10 blue, 11 red, 12 purple, 13 orange, 14 green, 15 maroon | [S] 1 §16 |
| Numbers | printed twice, on opposite sides, one upside down; black on a white round background; 6 and 9 underscored | [S] 1 §16 |
| Surface | unpolished, unwaxed in play; it still shows a sharp specular highlight (photos 7.1, 7.2) | [S] 1 §16, observation |
| Number disc size | about 0.41 × ball diameter across (angular radius about 24°), with a thin dark ring on tournament sets | [A] measured on photo 7.1 |
| Digit height | about 0.6 × the disc diameter, bold rounded sans-serif | [A] measured on photo 7.1 |
| Stripe band | colour between about ±32° of latitude: the band is about 0.53 × the diameter tall seen from the side | [A] measured on photos 7.1 and 7.2 |
| Colours as rendered (sRGB) | 1 #f2b400, 2 #1d46a8, 3 #d0281f, 4 #3d2b86, 5 #ee6e17, 6 #0e6a3c, 7 #7c1d24, 8 #141414, white #f3efe2 | [A] sampled from photos 7.1 and 7.2 and adjusted for lighting; to be checked in the reference renders |

The numbers and stripes are drawn on the sphere itself (a shader working from the ball's own
surface directions), so they follow the curvature and turn with the ball.

## 4. Cue

| Item | Value | Status |
|---|---|---|
| Length | about 57–59 in; average 59 in | [S] 6; WPA minimum 40 in [S] 1 §17; we use 58 in [A] |
| Weight | 17–21 oz, 19 oz most common | [S] 6; WPA maximum 25 oz [S] 1 §17; we use 19 oz = 0.539 kg [A] |
| Tip | 12–13 mm common for pool (range 9–14) | [S] 6; WPA maximum 14 mm [S] 1 §17; we use 13 mm [A] |
| Ferrule | 0.75–1 in, fibreglass or phenolic | [S] 6; a metal ferrule may be at most 1 in [S] 1 §17; we use 0.75 in, ivory-white [A] |
| Joint | two-piece cue jointed at the halfway point, steel collars and pin | [S] 6 |
| Shaft taper | "pro taper": constant diameter for 12–14 in from the tip, then widening toward the joint | [S] 6; 13 mm for 12 in, then to about 21 mm at the joint [A] |
| Joint diameter | about 0.84–0.85 in (21.3–21.6 mm) | [s] retailer and forum listings |
| Butt diameter | about 1.25–1.28 in (31.8–32.5 mm) at the butt cap | [s] forum posts |
| Butt layout | forearm about 12 in, wrap (handle) about 10–12 in, sleeve about 5–6 in, butt cap and rubber bumper | [s] forum design notes, [A] proportions |
| Wrap | linen, leather or nylon | [S] 6; dark Irish-linen look [A] |
| Cue mass in the physics | 0.539 kg; pooltool's default is 0.567 kg | [A] / [S] 3 |

## 5. Physics references and values

The simulation is a translation of pooltool's default event-based model (source 3). Each value is
listed with where it comes from; `docs/physics.md` describes the model itself.

| Quantity | Value | Status |
|---|---|---|
| Ball-cloth sliding friction μs | 0.2 | [S] 3 (pooltool's POOL_GENERIC, based on source 5); source 5 gives "about 0.2" [s] |
| Rolling resistance μr | 0.01 | [S] 3; source 5 gives "about 0.01" [s] |
| Spinning friction | μsp = (10·2/5/9)·R | [S] 3, called phenomenological ("ad hoc") in source 4 |
| Ball-ball restitution | 0.95 | [S] 3; measurements mostly 0.90–0.96 [s] 5 |
| Ball-ball friction | Alciatore fit μ = a + b·e^(−c·v) (a = 0.009951, b = 0.108, c = 1.088) | [S] 3, after source 5; most reported values are near 0.06 [s] 5 |
| Cushion restitution | 0.85 | [S] 3 (pooltool notes it may depend on the model) |
| Cushion friction | 0.2 | [S] 3 |
| Gravity | 9.81 m/s² | — |
| Sliding → rolling | the contact slip falls at (7/2)μs·g; a stun shot rolls on at 5/7 of its speed | [S] 4, standard result |
| Cue strike | instantaneous point impact on the cue ball, with squirt (the cue ball's deflection for side spin) | [S] 3, after source 5's TP A-30 and A-31 |

Two physical facts the tests check against, independent of pooltool: a centre-ball stroke on a
WPA table travels 4–4½ table lengths (source 1 §8), and a stun shot reaches rolling at 5/7 of its
initial speed.

## 6. Rules

The 8-ball rules follow the WPA *Rules of Play* effective 2026-10-21 (source 2), §§1–4. The
points that shape the engine:

- The rack: the apex ball on the Foot Spot, the 8 in the middle of the third row, one ball of
  each group in the two back corners, the rest without a pattern (§4.2).
- The break: cue ball in hand above the Head String. A legal break pockets a ball or drives at
  least four object balls to rails. An illegal break, the 8 on the break and fouls on the break
  each give a choice to one of the players (§4.3 a–h). A scratch on the break gives the incoming
  player the cue ball in hand above the Head String.
- Open table and groups: the 8 may not be hit first on an open table; legally pocketing a
  group's ball assigns that group (§4.4).
- Losing the rack: the 8 pocketed with a foul, before the group is cleared, in an uncalled pocket,
  or driven off the table (§4.8). The three-foul rule does not apply to 8-ball (§3.13).
- Fouls give the opponent the cue ball in hand anywhere (§4.9). Breaks alternate (§1.3).

Our deviations are listed in `docs/rules.md`.

## 7. Reference photographs

Downloaded to `docs/reference/` for study only. They are not part of the game and are never
published from this repository.

| # | File (Wikimedia Commons) | Licence | Author | Used for |
|---|---|---|---|---|
| 7.1 | `File:PoolRackAramith.png` | Public domain | Executive Billiards | Ball colours, number discs, digit style, stripe band, gloss |
| 7.2 | `File:Billiards_table_1.JPG` | CC0 | MarkBuckawicki | Cloth colour and texture, ball shadows, cue shaft and butt, cushion and rail at a low angle |
| 7.3 | `File:Billard_Break_Shot.jpg` | Public domain | Kucharek | Break-shot motion |
| 7.4 | `File:Billiard_table.JPG` | CC BY-SA 3.0 | מתניה | Home-table construction: wood rails with dot sights, apron, drop pockets with shields and cups, tapered legs |
| 7.5 | `File:Multi_Colour_Pool_Balls_in_Triangle_(14473335876).jpg` | CC BY 2.0 | Stuart Kerr | Rack, colours |

The models are original, made from the dimensions above. No image was traced, and no asset was
taken from any game.

## 8. Limits of this research

- The Dr. Dave "physical properties" FAQ and the retailer pages refuse automated readers, so
  their values are cited from search-result text and marked [s].
- No manufacturer publishes ball marking dimensions (disc size, stripe width); those are measured
  on the photographs above and marked [A].
- Jaw rounding and the pocket drop circle are not part of any specification; they are set by
  tests so that pockets accept and reject balls the way the WPA geometry intends.
