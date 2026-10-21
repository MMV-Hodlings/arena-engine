# arena_engine

The Cyber Authority PvP combat simulation. Pure, deterministic, dependency-free.

Implements step 1 of `docs/superpowers/specs/2026-10-15-cyber-authority-pvp-arena-design.md`.

## Using it

    import { createBattle, step, toFighter, narrate } from '@mmvh/arena-engine';

    const a = toFighter(chassisFromCaMyAssets, { posture: 'aggressive' });
    const b = toFighter(opponentChassis, { posture: 'balanced' });
    let state = createBattle({ seed: battleId, a, b });

    // The caller owns the clock. One step advances at most MAX_TICK_STEP_MS (250ms),
    // so driving the battle means calling it repeatedly.
    const { state: next, events } = step(state, { type: 'tick', toMs: 250 });
    for (const event of events) console.log(narrate(event, next.fighters)?.text);

Player input during a clash event:

    step(state, { type: 'clashInput', player: 'a', payload: { taps: 4, seq: 7 }, atMs: 12_340 });

**Caller contract — the two fields the engine cannot check for you:**

- `player` is trusted absolutely. Set it from the authenticated socket, never from the
  client's message. A client that can name itself could bind its opponent's Read stance
  before they choose, or send one tap message as them with a huge `seq` and lock them out
  of the rest of the event.
- `atMs` must be the server's receive time. Everything time-based is scored from it — the
  tap budget, the reflex press, the targeting stop — so a client-supplied value would hand
  the client a perfect score. Nothing in the payload is trusted for timing.

## Rules

- No I/O, no `Date.now()`, no `Math.random()`, no dependencies. The whole state is
  JSON-serialisable except `state.registry`, which holds the clash event modules —
  `rehydrate(state)` reattaches them after a Durable Object restores from storage.
- Every tunable lives in `src/constants.js`.
- Same seed plus same inputs equals the same battle, byte for byte. That is what makes
  replays and dispute resolution possible, so do not break it.

## Tests

    npm test          # node --test, colocated *.test.js — 294 tests
    npm run balance   # pairwise simulation over the roster
    npm run pacing    # events, spacing, battle length and posture balance (battle pacing design)

## Measured balance (2026-10-15, `npm run balance -- --seeds 60`, 4,680 battles)

| Power gap | Battles | Stronger robot wins | Mean length | Mean CI gap |
|---|---|---|---|---|
| even (<1.15x) | 240 | 45.8% | 73.5s | 1.06x |
| slight (<1.6x) | 360 | 80.3% | 68.9s | 1.13x |
| clear (<3x) | 540 | 96.3% | 69.2s | 1.23x |
| crushing | 3,540 | 100.0% | 21.4s | 7.97x |

Battles in the matchmade range (even + slight) average **71s**. The all-battles mean of
~34s is dragged down by the crushing bucket, which matchmaking would never create.

Skill sweep on an exactly even pair, A's competence against B at 0.5:

| Competence | 0 | 0.25 | 0.5 | 0.75 | 1 |
|---|---|---|---|---|---|
| A wins | 31.8% | 34.0% | 45.3% | 56.8% | 71.7% |

Monotonic, with a 40-point spread: between evenly matched robots, how well you play
decides the fight — which is the whole point of the interactive layer. A separate check
at n=2000 puts true mirror matches at **50.3%** (95% CI 48.1–52.5), so the engine itself
has no side bias.

## The Combat Index is not a matchmaking key

**Finding from the harness, for whoever builds the lobby.** The whitepaper's CI sums the
three combat stars flat, but attack enters the damage formula quadratically
(`ATK x ATK/(ATK + DEF)`) while HP is linear. Two robots with *identical* CI are therefore
not evenly matched: measured here, a 4/2/2 build beats a 2/2/4 build of the same CI about
**85%** of the time.

Pair on the harness's `powerRatio()` (the ratio of hits each robot needs to finish the
other) instead, or on something equivalent derived from the real formula. Matchmaking on
raw CI would produce fights that look fair on paper and are lopsided in practice.

CI remains correct as the whitepaper's public progression metric — it just is not a
measure of who beats whom.

## The Read: balance

Spec section 3.7's verbatim table made overload the strongest pick (+0.47 net damage a Read
against a uniformly random opponent, guard -0.50). On 2026-10-19 the triangle was rebalanced
in `resolveStances` (`src/actions.js`): the three matchup margins are now 0.50 / 0.49 / 0.30,
so the optimal mix (`OPTIMAL_STANCE_MIX`) is strike 38% / guard 39% / overload 23% and no pick
is the default answer. Reads stay deliberately outside the +/-20% skill cap.
`src/ai.test.js` pins the payoff numbers so a change to the table is noticed.

## Pacing and events

The battle pacing design (`docs/superpowers/specs/2026-10-19-cyber-authority-arena-battle-pacing-design.md`),
in `src/constants.js` and `src/battle.js`:

- **The event mix.** Every event is drawn at the same weight except Power Routing at three
  quarters (`CLASH_WEIGHTS`). The Read is drawn like the rest; the robot whose action drew it
  is the one winding up.
- **How often.** The chance rises with each action since the last event closed:
  0.3, 0.6, then certain (`CLASH_CHANCE_RAMP`). First blood and the first drop below a quarter
  HP still force one. About nine events a balanced battle, never more than three actions apart.
- **Heavy swings** settle at once through the stance triangle: the swinger overloads and the
  target answers from `OPTIMAL_STANCE_MIX`, so a heavy swing is a gamble, never free damage.
  (Opening a Read on every one made Reads half of all events; letting most land as a plain 1.6x
  hit had aggressive robots beating defensive ones 87% of the time.)
- **Rhythm.** Each robot acts about every six seconds (`ACTION_CADENCE_MS`), and two actions
  are never closer than two (`MIN_BLOW_GAP_MS`).
- **Hints and briefings.** A drawn event first emits an `omen` and holds the stage for
  `OMEN_MS` (3s) with the fight paused. Timing events then announce themselves `BRIEFING_MS`
  (5s) before input opens: `clashStart` carries `announcedAt`, `startedAt` and `endsAt`, and
  event modules keep measuring from `startedAt`.
- **Decisions.** The Read and Power Routing give `DECISION_WINDOW_MS` (15s) and close the
  moment both players have committed (`settled`). A pick is binding, so the early close leaks
  nothing.
- **No sudden death.** Damage no longer grows with time. `MAX_BATTLE_MS` (20 minutes since
  2026-10-21) is a hidden safety net that no measured battle reaches (longest of 15,600 simulated:
  13m34s, two defensive robots).
- **Surge or guard** (2026-10-21). A robot with a surge ready only surges or guards: its strike and
  heavy-swing weights become the surge's (`chooseAction`). A defensive robot holding one guards 2
  less (`READY_GUARD_CUT`), which keeps posture balance where it was (49% / 59% / 61%).
- **Fewer repeats** (2026-10-21). The event just drawn is `REPEAT_WEIGHT_FACTOR` (a quarter) as likely
  next (`state.lastClashId`): back-to-back repeats 4% instead of 14%, every event's share unchanged.
- **No draws** (2026-10-21). An exchange that would knock out both robots spares its winner on 1 HP;
  a tie by stance goes to the robot with more of its health left, then the higher CI
  (`standingLeader`, shared with the time limit).
- **The feed's beats** (`src/beats.js`, 2026-10-21). No two lines of the fight land at once. Each
  resolution is a *moment*; its events are spaced on the battle clock and queued (`state.queue`),
  then released as the clock reaches them: `LINE_BEAT_MS` (1.5s) between ordinary lines,
  `HINT_LEAD_MS` (2s) before an event's hint, `RESULT_BEAT_MS` (2s) between an event's result card
  (`clashEnd`, which narrates nothing), its verdict line (`clashVerdict`) and its effect (a Read's
  exchange, Tug of War's extra hit). State changes when it happens; only its events wait, and the
  next action, the event's opening and the end wait for the last line's beat. A decided battle
  sits in `phase: 'finishing'` until its K.O. line is out, and ends on that line's time, so any
  tick grid ends it at the same moment.
- **Narration.** One line per blow: blows and exchanges carry what they dealt and their
  `moments` (`src/moments.js`), and their damage events narrate nothing. All copy lives in
  `src/narration-lines.js`.

`npm run pacing -- --seeds 200` (2026-10-19): balanced mirrors hold 8.8 events (Read 1.27,
Reflex Strike 1.33, Power Routing 0.99); aggressive beats balanced 49.3%, aggressive beats
defensive 58.5%, balanced beats defensive 61.1%. Battle length there undercounts real play,
because the AI commits a decision half a second in.

`ENGINE_VERSION` is held at 1.0.0 through development, so the worker and the frontend must
pin the same engine commit; see the reference doc, section 8 item 6.
