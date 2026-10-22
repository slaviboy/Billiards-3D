# Rules

Pool plays 8-ball by the World Pool-Billiard Association's *Rules of Play* (effective
2026-10-21), sections 1–4, with the deviations listed below. The code is `src/rules/`; the tests in
`tests/unit/rules/` go through every branch. The same rules apply on one device and online, where
each player's game judges every shot itself from its own simulation.

## How a rack goes

- **The rack.** Fifteen balls in a triangle, the apex ball on the foot spot, the 8 in the middle of
  the third row, one solid and one stripe in the two back corners, the rest in no pattern. A seed
  both players share decides the arrangement.
- **The break.** The breaker places the cue ball anywhere above the head string. Nothing has to be
  called or hit first. A legal break pockets an object ball or drives at least four object balls to
  rails.
  - Ball pocketed, no foul: the breaker stays at the table; the table stays open.
  - Nothing pocketed but a legal break: the other player comes to the table.
  - Illegal break: the other player chooses to play the table as it lies, re-rack and break, or
    re-rack and have the breaker break again.
  - The 8 pocketed on a legal break: the breaker chooses to spot the 8 and play on, or break again.
  - The 8 pocketed on a foul break: the other player chooses to spot the 8 and play with the cue
    ball in hand above the head string, or break again.
  - Any other foul on the break (a scratch, for instance): the other player has the cue ball in hand
    above the head string.
- **Open table.** Until the groups are assigned, any ball but the 8 may be hit first. If a group
  has been cleared entirely, a player may hit the 8 first, as if that group were his.
- **Groups.** The first ball a player pockets legally after the break makes its group (solids 1–7
  or stripes 9–15) his, and the other group his opponent's.
- **Continuing.** A player stays at the table while he legally pockets balls of his group. A safety
  ends his turn whatever falls.
- **Fouls** pass the table to the opponent, who takes the cue ball in hand anywhere: a scratch,
  hitting the wrong ball first (or none), no ball pocketed and no ball driven to a rail after the
  first contact, playing from above the head string without crossing it or first hitting a ball on
  or beyond it, and letting the shot clock run out. Balls pocketed on a foul stay down. There is no
  three-foul rule in 8-ball.
- **The 8.** Once his group is cleared a player shoots the 8, calling its pocket. He wins the rack by
  pocketing it legally in that pocket, and loses it by pocketing it with a foul, before his group is
  cleared (including on the same shot as his last ball), or in another pocket.
- **Matches** are races to a number of racks; the break alternates.

## Deviations from the WPA rules

| WPA | Pool | Why |
|---|---|---|
| Every shot is called (ball and pocket), except obvious ones (1.7, 4.6) | Only the 8's pocket is called | The usual online convention; calling every shot by tapping would slow play down |
| Groups go by the legally pocketed *called* ball (4.4) | By the first object ball pocketed legally in the shot | Follows from the above |
| A safety must be declared to the referee (2.16) | A Safety switch before the shot | No referee |
| A lag decides the first break (1.2) | A coin toss by the host's shared random seed | There is no lag shot in this game |
| The breaker may ask for the nearest ball to be spotted when all legal balls are above the head string and the cue ball is in hand there (1.6) | Not offered | It needs a separate interaction for a very rare position |
| Ball in hand anywhere on the playing surface (1.6) | Anywhere the ball's centre is at least a radius (plus 10 µm) inside the cushion noses | The simulation's cushions start there; a ball partly in a pocket's mouth would not be on the cloth |
| Stalemate procedure (1.13, 4.11) | Not implemented | Needs a referee's judgment |
| Slow play is a foul with a shot clock (3.14) | Same; on the break, a time-out makes the opponent break instead | Nothing on the table has moved yet, so there is no position to pass on |
| Jump shots, balls driven off the table (2.6, 2.9, 3.5, 4.3 g, 4.8 d) | Do not occur | The simulation keeps every ball on the cloth |
| Fouls of the body and equipment (3.4, 3.6, 3.7, 3.8, 3.9, 3.12, 3.15) | Do not occur | The controls cannot make them |
| A ball frozen to a rail is not "driven to a rail" by staying there (2.7) | A ball counts as driven to a rail when it touches a cushion during the shot | The simulation records contacts, not who declared a ball frozen |
