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

    step(state, { type: 'clashInput', player: 'a', payload: { taps: 4, windowMs: 100, seq: 7 }, atMs: 12_340 });

## Rules

- No I/O, no `Date.now()`, no `Math.random()`, no dependencies. The whole state is
  JSON-serialisable except `state.registry`, which holds the clash event modules —
  `rehydrate(state)` reattaches them after a Durable Object restores from storage.
- Every tunable lives in `src/constants.js`.
- Same seed plus same inputs equals the same battle, byte for byte. That is what makes
  replays and dispute resolution possible, so do not break it.

## Tests

    npm test          # node --test, colocated *.test.js — 173 tests
    npm run balance   # pairwise simulation over the roster

## Measured balance (2026-10-15, `npm run balance -- --seeds 60`, 4,680 battles)

| Power gap | Battles | Stronger robot wins | Mean length | Mean CI gap |
|---|---|---|---|---|
| even (<1.15x) | 240 | 44.6% | 74.9s | 1.06x |
| slight (<1.6x) | 360 | 82.8% | 70.1s | 1.13x |
| clear (<3x) | 540 | 95.0% | 70.4s | 1.23x |
| crushing | 3,540 | 100.0% | 21.7s | 7.97x |

Battles in the matchmade range (even + slight) average **72.0s**. The all-battles mean of
33.8s is dragged down by the crushing bucket, which matchmaking would never create.

Skill sweep on an exactly even pair, A's competence against B at 0.5:

| Competence | 0 | 0.25 | 0.5 | 0.75 | 1 |
|---|---|---|---|---|---|
| A wins | 27.2% | 28.5% | 44.0% | 51.8% | 61.5% |

Monotonic, with a 34-point spread: between evenly matched robots, how well you play
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
