# Physics

The simulation in `src/physics/` is a TypeScript translation of the default physics of
[pooltool](https://github.com/ekiefl/pooltool) 0.6.0 (Evan Kiefl and contributors, Apache-2.0), an
event-based billiards simulator built for science and engineering. This page describes the model,
lists where the translation differs from the original and why, and records how it was checked.

## The model

Balls move on the cloth (their centres at height R); everything is in SI units, in the table's frame
(x across, y along from the head cushion, z up).

**Motion between events** is in closed form, so a shot is simulated by jumping from one event to
the next rather than in time steps:

| State | Path | Ends when |
|---|---|---|
| Sliding | the contact point slips with velocity u = v + ω × (−R ẑ); friction μs·m·g opposes it, so its direction û is fixed: r = r₀ + v₀t − ½μs·g·t²·û, v = v₀ − μs·g·t·û, ω_xy = ω₀ − (5μs·g/2R)·t·(û × ẑ) | the slip is gone: t = 2\|u\|/(7μs·g) |
| Rolling | r = r₀ + v₀t − ½μr·g·t²·v̂, ω_xy = (−v_y, v_x)/R | it stops: t = \|v\|/(μr·g) |
| Spinning | in place, ω_z decays at 5μsp·g/2R | the spin is gone |

Vertical spin decays the same way in every state. A ball that stops rolling while it still spins
goes on spinning in place.

**Events** are found as the roots of polynomials in time: two balls touch when |Δr(t)|² = (2R)²
(a quartic), a ball meets a pocket's rounded lip when its distance to the lip's centre reaches
r + R (a quartic), drops when its centre enters the pocket's slate cut (a quartic), and meets a
straight cushion when its distance to the nose line reaches R within the segment (a quadratic). The
earliest event is resolved, the predictions involving the balls it changed are recomputed, and the
rest are kept.

**Resolution** (pooltool's default models):

- *Ball and ball:* frictional, inelastic, equal masses (after Dr. Dave Alciatore's technical proofs
  A-5, A-6 and A-14). The normal speeds are exchanged with restitution e_b = 0.95. Friction between
  the balls, μ = 0.009951 + 0.108·e^(−1.088·v) with v the surfaces' relative speed, transfers
  tangential momentum and spin (the throw of cut shots), stopping at the point where the surfaces
  would no longer slip. Both balls leave sliding.
- *Ball and cushion or lip:* Stronge's compliant frictional collision. The cushion nose touches the
  ball at 63.5 % of its height, so the contact normal points from the nose line down to the ball's
  centre; the cushion acts as springs along and across the contact (frequency ratio 1.8), the
  contact point may slip, stick and slip again, the normal speed returns scaled by e_c = 0.85, and
  friction f_c = 0.2 changes speed and spin. Running english changes a bank's angle this way.
- *Cue and ball:* an instantaneous impulse at the tip's contact point (technical proof A-30): speed
  2·V₀ / (1 + m/M + (offset terms)/(2R²/5)), spin from where the tip lands, elevation included,
  and squirt (TP A-31) for side spin, with the cue's end mass m/30.
- *Pocket:* a ball whose centre enters the pocket circle drops.

**Parameters** (pooltool's POOL_GENERIC unless noted): m = 0.170097 kg, R = 0.028575 m, μs = 0.2,
μr = 0.01, μsp = (10·2/5/9)·R, e_b = 0.95, e_c = 0.85, f_c = 0.2, g = 9.81 m/s²; cue mass
0.539 kg (19 oz; pooltool uses 0.567 kg). Sources: `docs/visual-research.md`, section 5.

## Differences from pooltool, and why

1. **Deterministic arithmetic.** Both players' browsers simulate every shot, so the result must be
   identical to the last bit in every JavaScript engine. Only exactly rounded operations are used;
   sines, cosines, exponentials and arc-cosines come from `dmath.ts`, built from those operations.
   pooltool's rotations into the ball's frame (angles via atan2, then sin/cos) are replaced by
   unit vectors, and the cue's angles arrive as cosines and sines decoded from integers.
2. **Root finding.** pooltool solves quartics with a translation of ACM TOMS Algorithm 1010 (cube
   roots, trigonometry). Here the derivative's roots split the interval up to the balls' next change
   of motion into monotonic pieces, and a bracketed Illinois solver finds the first root
   (`roots.ts`). Only the first closing of a gap is searched for, and pairs that cannot meet before
   that horizon are skipped. A turning point within rounding error of zero counts as a touch (a
   graze), the counterpart of pooltool accepting nearly real complex roots.
3. **A fault fixed.** When two balls roll the same way with the same deceleration, the contact
   quartic's two leading coefficients are exactly zero. pooltool 0.6.0's solver then returns four
   zero roots, and the balls "collide" at once however far apart they are. Here leading zeros are
   dropped and the remaining quadratic is solved. (Found by the comparison below, scenario "draw".)
4. **Stronge model.** The slip time is found by bisection instead of scipy's TOMS 748. Where
   pooltool would stop on a failed assertion (an input outside the model's range), the gross-slip
   result is used, so every input has an answer. The final normal speed is taken as exactly −e·v₀
   (pooltool computes cos π numerically).
5. **Ties.** Events at exactly the same time are ordered by pooltool's tiers (cue, then changes of
   motion and pockets, then collisions) and energy, then by kind and by ball and cushion number;
   pooltool's last resort is its dictionaries' order.
6. **No impulse when moving away.** A contact reached at a ball's closest approach, moving along or
   away from the cushion (possible only for grazes), changes nothing. pooltool would stop on an
   assertion there.
7. **Limits.** A shot is cut off after 10 000 events (balls stopped where they are); no real shot
   comes near it. Balls never leave the cloth: there are no jump shots, and the cue's elevation only
   changes the spin and speed it gives.

The table's cushions, lips and pockets are pooltool's kind of pieces (straight segments, circles
for the rounded lips, circles for the pocket cuts), placed from the WPA measurements
(`src/table/geometry.ts`, `docs/visual-research.md`, section 2).

## How it was checked

- **Against pooltool itself.** 18 scenarios (stun, natural roll, head-on, draw, follow, half-ball,
  banks with and without english, corner and side pockets, a grazed jaw, a ball beside the lip, a
  rail-hugging ball, a combination, an elevated cue, a 7-ft bank and a full break) were simulated by
  pooltool 0.6.0 on the same table (`tools/pooltool-fixtures/`). The translation reproduces every
  event, in order, of every scenario: times agree to within 4·10⁻¹⁴ s and final positions to within
  3·10⁻¹⁴ m; on the break, 120 events agree to within 1.2·10⁻⁹ s and 1.5·10⁻¹⁰ m. The exception is
  "draw", identical up to pooltool's fault above. (`tests/unit/physics/pooltool.test.ts`)
- **Against closed-form results.** A stun shot rolls on at 5/7 of its speed after 2v/(7μs·g); a
  rolling ball stops after v²/(2μr·g); a ball struck 2R/5 above centre rolls at once; a head-on stun
  hit splits the speed (1−e)/2 and (1+e)/2; a stun cut sends the balls off between 82° and 90°
  apart (restitution and throw close the ideal 90°); a rolling half-ball hit deflects the cue ball
  near 30°; draw comes back, follow goes on; side spin squirts away from the tip.
  (`tests/unit/physics/simulate.test.ts`)
- **Against published figures for the table's speed.** Dr. Dave's technical proof TP B.6 estimates
  how far a rolling ball travels on a 9-ft table, rail losses included, with every rebound killing
  the spin (stun) at a rebound coefficient of 0.7. Rolling from the head rail, the translation's
  ball runs as far as his estimate at touch speed and up to a fifth further at power speed, as a
  model that keeps some roll off the rail should:

  | Speed | Dr. Dave (table lengths) | Pool |
  |---|---|---|
  | touch, 1.5 mph | 0.90 | 0.90 |
  | slow, 3 mph | 1.68 | 1.83 |
  | lag, 3.465 mph | 2.00 | 2.04 |
  | medium, 7 mph | 3.01 | 3.15 |
  | fast, 12 mph | 3.69 | 4.17 |
  | power, 20 mph | 4.72 | 5.59 |

  The WPA's own test (a firm centre-ball shot from the head spot through the foot spot travels 4 to
  4½ table lengths) is met with the cue ball leaving at 14–16 mph, reading "firm" as between fast
  and power. pooltool's default cloth and cushions therefore play like a WPA table, and no parameter
  was changed. (`tests/unit/physics/calibration.test.ts`)
- **Invariants** over 300 random shots: every shot ends, momentum is conserved in every ball-ball
  collision, the total energy never rises at an event, balls never overlap, and every ball ends on
  the cloth (or in a pocket's throat) or pocketed.
- **Determinism.** 200 seeded shots give identical results in Node, Chromium, Firefox and WebKit
  (`playwright.determinism.config.ts`).
- **Speed.** A full break takes about 3 ms in Node on a desktop computer
  (`scripts/physics-bench.ts`).
