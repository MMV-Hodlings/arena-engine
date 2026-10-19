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

    npm test          # node --test, colocated *.test.js — 191 tests
    npm run balance   # pairwise simulation over the roster

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

## The Read: balance and frequency

**Balance.** Spec section 3.7's verbatim table made overload the strongest pick (+0.47 net
damage a Read against a uniformly random opponent, guard -0.50). On 2026-10-19 the triangle
was rebalanced in `resolveStances` (`src/actions.js`): the three matchup margins are now
0.50 / 0.49 / 0.30, so the optimal mix is strike 38% / guard 39% / overload 23% and no pick
is the default answer. Reads stay deliberately outside the +/-20% skill cap.
`src/ai.test.js` pins the payoff numbers so a change to the table is noticed.

**Frequency.** A heavy swing telegraphs into a Read one time in five
(`READ_CHANCE_ON_HEAVY`); the other four land as a plain overload. Section 3.7 opens a Read
on every telegraph, and because that path sits outside `CLASH_CHANCE` it stacked on top of
the ~5 random events: a Read was 46% of all clash events (59% for aggressive robots) and a
battle held ~9 clashes. Now a battle holds ~0.8 Reads and ~6 clashes.

`ENGINE_VERSION` is held at 1.0.0 through development, so the worker and the frontend must
pin the same engine commit; see the reference doc, section 8 item 6.
