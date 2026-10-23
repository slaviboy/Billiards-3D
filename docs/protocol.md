# Online protocol

Two players' browsers play a match directly, over a WebRTC data channel, with nothing in between
to referee. Each side simulates every shot and judges the rules itself, from its own events, and
the two compare the result. This page describes the messages, what each side checks, how the two
tables are kept in step, what happens when a player drops out, and the limits. The code is
`src/net/` (the session, which knows no game) and `src/game/gameMessages.ts` and
`src/game/GamePort.ts` (8-ball's part).

## Finding each other

- **The link.** The host makes an invitation: 128 random bits as 22 base64url characters, in the
  link's hash (`https://…/pool/#g=<secret>`). Browsers never send the hash to the web server. The
  same link is shown as a QR code, drawn in the page.
- **The room.** Both players join a room on public Nostr relays named by
  `SHA-256("pool room:" + secret)` (the first 16 bytes): the same for both, different for every
  game, and telling nothing of the secret. Trystero (app id `pool-slaviboy`) finds the two there.
  The secret is Trystero's password: it encrypts the handshake, so relays and anyone without the
  link see neither the offer nor the network addresses in it.
- **One partner.** The first peer admitted is the partner; anyone else is refused at the handshake
  and their messages are ignored. Only `src/net/PeerLink.ts` touches Trystero or a peer connection,
  and nothing of the connection is logged or put on `window`.
- **The clock.** The relays compare the times signals carry, so before connecting each page asks
  its own web server for the time (`HEAD` of the page, its `Date` header) and Trystero stamps and
  filters signals with that clock (`scripts/trystero-clock-skew.ts`). Players whose clocks are
  hours off still meet.
- **Consent first.** Every online game starts with the 18+ and IP-address warning, its box
  unticked, before anything connects; the end-to-end test counts sockets and peer connections to
  prove it.

## Messages

Every message is a JSON object with a type `t`, at most 4096 bytes. The session's envelope
(`src/net/protocol.ts`):

| Message | From | Meaning |
|---|---|---|
| `hello {v, build, name, token?}` | both | On every connection: the protocol version, the build (below), the player's name, and once the guest has one, its token. |
| `setup {token, seed, race, shotClock, size, names, host, firstBreak}` | host | The match's terms and the guest's token. Sent when the guest first arrives and again on every return. |
| `desync {n}` | both | After shot `n` the sender's table differs from the one the other reported (see below). |
| `resign` | both | The sender gives up the match. |
| `rematch` | both | The sender wants a rematch, or accepts the one offered. |
| `media {mic, cam}` | both | Whether the sender's microphone and camera are on (shown only as a hint; the cards follow the tracks that arrive). |
| `bye` | both | The sender is leaving; a match in progress is theirs to lose. |

8-ball's messages (`src/game/gameMessages.ts`):

| Message | From | Meaning |
|---|---|---|
| `shot {n, yaw, pitch, speed, a, b, x?, y?, pocket, safety, h}` | shooter | Shot number `n` of the match: the cue as the integers both simulations start from (`src/game/shotCodec.ts`: heading in 2²⁰ steps, elevation in 0.1°, speed in mm/s, tip offset in thousandths of the radius), the cue ball's placement in 10 µm units when it was in hand, the 8's called pocket (null when none is due), the safety call, and `h`, 16 hex digits of the fingerprint of the table the shot led to. |
| `aim {yaw, pitch, speed, a, b, pull}` | shooter | A preview: where the cue is and how far it is drawn back (thousandths). |
| `place {x, y}` | shooter | A preview: where the cue ball in hand is being put. |
| `decide {n, choice}` | decider | The answer to a choice the break left (WPA 4.3), before shot `n`. |
| `timeout {n}` | shooter | The sender's own shot clock ran out before shot `n`. |
| `sync {n, rack, score, phase, breaker, turn, groups, inHand, decision, winner, end, match, balls, h}` | host | The table at rest: shots played, rack number, score, the rack's state, the match's winner, each ball as `[x, y, pocketed]`, and its fingerprint. Positions travel as JSON numbers, which carry doubles exactly; the worst case is under 2 KB. |

The **fingerprint** is 64-bit FNV-1a over every ball's position and state and the rules' state
(shot number, rack, score, phase, breaker, turn, groups, ball in hand, decision): equal
fingerprints mean equal tables, to the last bit (`MatchController.hash`).

The **terms**: a 16-hex-digit seed (it decides every rack; a rematch derives the next seed from it,
the same on both sides), the race (1–15 racks), the shot clock (0, or 10–300 s), the table (7 or
9 ft), the two seats' names, the host's seat and who breaks first. The host's dialog offers what a
match on one device offers; a coin toss is the host's.

The **build** is a fingerprint of the code both players must share (the simulation, the tables,
the rules, the match and its messages, the envelope; `scripts/build-id.ts`). Two different builds
might not simulate alike, so a `hello` with another build or protocol version ends the connection
on both sides with a request to reload, and nobody loses anything.

## What each side checks

Everything from the other player passes three checks, in order; a failure in the last two is a
rule break.

1. **The guard** (`PeerGuard`), as each message arrives: size (4096 bytes, counted in UTF-8), rate
   (20 a second on average, bursts of 40, counted at arrival, so messages that wait behind a slow
   one are not held against the sender) and shape (exactly one of the messages above: no missing,
   extra or wrongly typed field, names cleaned of control and direction characters and cut to 24
   characters). Anything else is dropped and counted; the 20th drop disconnects the peer, who
   forfeits.
2. **The session** (`OnlineSession`), one message at a time, in order: nothing counts before the
   peer's `hello`, and once the token has been handed out a peer must show it, in both directions,
   before anything else it says is weighed (a stranger with a leaked link can neither take the
   guest's seat, nor pose as the host, nor end the session). Only the host sets the terms, once;
   only the guest takes a table, and only when it asked for one. Camera and microphone tracks are
   held until the peer has shown who they are.
3. **The match** (`PoolPort`, against this device's own `MatchController`): a `shot` must be in the
   cue's range (`isShotCode`; the 8's pocket 0–5), it must be the sender's turn, `n` must be the
   next shot's number, the cue ball must be placed exactly when it is in hand and only where it may
   go (above the head string for the break, never on a ball, at least a radius inside the
   cushions), and a pocket must be called exactly when the 8 is due. A `decide` must answer the
   decision pending, be the sender's to make and be one of its choices; a `timeout` must come on
   the sender's turn. Then the shot is simulated and judged here.

A rule break forfeits the match on the honest side and the connection is cut; the honest player
sees what the other app did, never where it came from. Previews out of turn change nothing (a
preview can arrive just after the turn passed); a preview the cue could not make is a rule break.
Play that arrives after the match has ended (it crossed a resignation) changes nothing either.

A received shot is played out on the screen after the one before it. A screen plays at normal
speed or faster, so one still playing once the shots could have played out at normal speed has
stopped drawing (a tab in the background); the match does not wait for it, and that shot jumps to
its end.

## Staying in step

After playing a received shot, the receiver compares its table's fingerprint with `h`. A
difference is not a rule break (an honest bug, or a lie that gains nothing), so the two are brought
back in step, the host's table being the reference:

- When the **guest** finds the difference, it stops (its controls are held), sends `desync {n}` and
  waits; the host answers with `sync`, which the guest takes.
- When the **host** finds it, it stops and sends `desync {n}`; the guest stops in turn and echoes
  `desync {n}`; only then does the host send `sync`. Whatever the guest sent before it stopped is
  ignored, so nothing in flight crosses the host's table.
- Both sides count the differences, and a table the guest takes on a return (below) counts as one
  too; after more than three in one session it ends on both sides with a note, and **nobody
  loses**.
- A peer that does not answer within 15 seconds while the tables are brought in step loses, as one
  that stalls (judged after the messages already received, in case the answer was among them).

A `sync` is taken only if it is a table of this match (score within the race, a possible rack, a
decision only in a decision phase, balls on the cloth or in a pocket, and so on) and its content
gives exactly its fingerprint; otherwise the host forfeits.

## Dropping out and coming back

- **Away.** When the connection drops, both sides hold play (nobody shoots while the other cannot
  see) and the shot clocks stop. Nobody can resign while the other player is away (their table
  would undo it on their return). After two minutes away the win can be claimed (offered again
  every minute until it is); claiming it ends the session, since the absent player's table would
  otherwise come back with them.
- **Back.** Both say `hello` again; the host sends `setup` and its table in a `sync`. The guest
  holds play until it has the table, and compares: its own table, nothing to do; its table from just
  before its own last action (a shot, a decision or a time-out lost on the way when the connection
  dropped), it sends that action again and the host plays it; anything else, it takes the host's,
  even several shots behind (shots made before either side noticed the drop are lost), and tells
  the host, both sides counting it as a difference.
- **Reload.** Each tab keeps its game in `sessionStorage` (this tab only), checked like a message
  when read back. A reloaded player is asked the warning again, then rejoins with the token; a
  reloaded host waits, holding its own table. A reloaded guest does not remember its last action,
  so one lost on the way is not sent again; the host's table stands.
- **Leaving.** `bye` and the connection closes; a match in progress is lost by whoever leaves.

## Between racks, and rematches

Online, a rack that is over leads to the next by itself on both sides, three seconds after its last
shot has played out, so the breaker's clock starts alike on both; the result dialog's "Next rack"
only closes it. After the match, a rematch starts when both have asked (each `rematch` is answered
by the other's, and a side that starts on receiving one says so again, so a request lost while the
other was away does not leave one side waiting); the other player breaks first, on a seed both
derive from the last one.

## The shot clock

Both sides keep both clocks (`PoolPort`), from the same moment: a turn's clock starts once every
shot so far could have played out, one after another, at normal speed (the shots' simulated
lengths, plus a second each for balls settling in a pocket), whatever either screen is actually
doing. A faster playback setting, or a tab in the background that has stopped drawing, changes
nothing; menus do not stop the clock either, since the other player cannot see them.

- **This player's turn.** When the clock runs out, the port calls time (`MatchController.timeOut`),
  sends `timeout` and says so. A player who switched to another tab during the other's shot gets
  the foul, not a lost match.
- **A choice the break left** is timed the same way (online only; the WPA rules time shots): when
  the decider's clock runs out, their port takes the first choice on offer (play the table as it
  lies, or spot the 8 and play on) and sends it as their `decide`.
- **The other player's turn.** The port waits for their `timeout` (or their shot), allowing the
  measured network delay (the median of the last five round trips, capped at one second) and a
  five-second grace. An app that lets its clock run past all of that without a word has stopped
  keeping it, and loses (judged after the messages already received, in case its word was among
  them).

Each card shows its player's clock as this side keeps it, the other player's with the allowance.
While play is held (the other player away, the tables being brought in step) no clock runs, and
the turn's clock starts afresh when play resumes.

## Limits

| What | Limit |
|---|---|
| Message size | 4096 bytes |
| Messages | 20 a second on average, bursts of 40; 20 dropped messages disconnect |
| Previews sent | at most 8 a second, only when something changed |
| Names | 24 characters, cleaned |
| A guest looking for the game | 45 s, then it gives up with a message |
| Network allowance on the other player's clock | the measured round trip, at most 1 s |
| Grace beyond the other player's clock | 5 s |
| Answer while the tables are brought in step | 15 s |
| Differences in one session | 3; the fourth ends the session, nobody losing |
| Away before the win can be claimed | 2 min |

## What it does not protect against

- **The host's table.** When the two tables have to be brought in step, and when a guest comes
  back, the guest takes the host's table if it is a possible table of the match. A modified host
  app could claim the tables differ, or drop out and come back, and send another possible table;
  it can do so at most three times before the session ends without a winner. A history of every
  action would let the guest check the host's table, but would not fit in one message for a long
  match.
- **Untimed matches.** Without a shot clock, a player who stays connected but never plays holds
  the other up; the only way out is to leave, which loses the match. The claim is for players who
  are away.
- **A drop in the first moments.** If the connection drops after the host has handed out the
  guest's token but before the guest received it, the guest cannot prove who it is when it comes
  back, and the host turns it away; the host has to make a new link.
- **A dropped connection gives the turn a fresh clock.** Play is held while a player is away and
  the clock starts afresh when they are back, so a player could drop out (or reload) on purpose to
  gain time on a shot.
- **Networks that need a relay.** The connection is direct; there is no TURN server. About one pair
  of networks in ten (some mobile data and office networks) cannot connect directly, and the
  players are told so.

## Performance

A break simulates in about 3 ms (`scripts/physics-bench.ts`), and a received shot is simulated
once, so the simulation runs on the page's own thread; a worker would add a copy of the table each
way and gain nothing measurable.
