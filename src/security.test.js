/**
 * Adversarial tests: every one of these reproduces a defect found in the whole-branch
 * review. They exist to stay failed if the hole is ever reopened.
 */

import test from 'node:test';
import assert from 'node:assert';
import { createBattle, step } from './battle.js';
import { toFighter } from './stats.js';
import { hashSeed, nextRandom } from './rng.js';
import { MAX_TICK_STEP_MS, MAX_TAPS_PER_SECOND, MAX_BATTLE_MS } from './constants.js';
import { tugOfWar } from './events/tugOfWar.js';
import { reflexStrike } from './events/reflexStrike.js';
import { targetingLock } from './events/targetingLock.js';
import { sequenceLock } from './events/sequenceLock.js';

const fighter = (over = {}) =>
  toFighter(
    {
      asset_id: over.asset_id ?? '1',
      name: 'Bot',
      clan: 'Onerion',
      core_power: over.cp ?? 296,
      immutable_data: {
        cp: String(over.cp ?? 296),
        element: 'Neutral',
        'attack star': String(over.stars ?? 3),
        'defense star': String(over.stars ?? 3),
        'hp star': String(over.stars ?? 3),
        'pvp ready': '1',
        'modules equipped': '5',
      },
    },
    {},
  );

function advanceUntil(state, predicate, { limit = 4000 } = {}) {
  let now = state.clockMs;
  for (let i = 0; i < limit && !predicate(state); i++) {
    now += MAX_TICK_STEP_MS;
    state = step(state, { type: 'tick', toMs: now }).state;
  }
  return state;
}

function battleInClash(seed = 'sec') {
  const state = createBattle({
    seed,
    a: fighter(),
    b: fighter({ asset_id: '2' }),
    clashRegistry: { events: { [tugOfWar.id]: tugOfWar }, weights: { [tugOfWar.id]: 1 } },
  });
  return advanceUntil(state, (s) => s.phase === 'clash');
}

// ── Finding 1 (Critical): the tap budget must come from server-validated time ───────

test('a forged windowMs cannot inflate the tap budget', () => {
  const state = battleInClash();
  const after = step(state, {
    type: 'clashInput',
    player: 'a',
    payload: { taps: 1e9, windowMs: 1e9, seq: 1 },
    atMs: state.clash.startedAt + 1,
  }).state;

  const scored = tugOfWar.score(after.clash.eventState);
  assert.ok(
    scored.a < 0.55,
    `one forged message scored ${scored.a}; the clamp was computed from client input`,
  );
});

test('drip-feeding many messages inside one event cannot exceed the cap', () => {
  let state = battleInClash();
  const duration = state.clash.endsAt - state.clash.startedAt;
  for (let seq = 0; seq < 200; seq++) {
    state = step(state, {
      type: 'clashInput',
      player: 'a',
      payload: { taps: 50, windowMs: 1000, seq },
      atMs: state.clash.startedAt + Math.min(duration, seq),
    }).state;
  }
  const banked = state.clash.eventState.a.taps;
  const ceiling = Math.ceil((duration / 1000) * MAX_TAPS_PER_SECOND);
  assert.ok(banked <= ceiling, `banked ${banked} taps against a ceiling of ${ceiling}`);
});

test('an honest masher still banks what the clamp allows', () => {
  let state = battleInClash();
  const duration = state.clash.endsAt - state.clash.startedAt;
  const windows = Math.floor(duration / 100);
  for (let seq = 0; seq < windows; seq++) {
    state = step(state, {
      type: 'clashInput',
      player: 'a',
      payload: { taps: 2, windowMs: 100, seq },
      atMs: state.clash.startedAt + seq * 100,
    }).state;
  }
  const banked = state.clash.eventState.a.taps;
  assert.ok(banked >= windows, `an honest player at ~12/s banked only ${banked} over ${windows} windows`);
});

// ── Finding 2 (Critical): a non-numeric tick must not wedge the battle ─────────────

test('a tick with no toMs is ignored instead of poisoning the clock', () => {
  const state = createBattle({ seed: 'nan', a: fighter(), b: fighter({ asset_id: '2' }) });
  const result = step(state, { type: 'tick' });
  assert.equal(result.state, state, 'a malformed tick should change nothing');
  assert.deepEqual(result.events, []);
});

test('non-numeric tick values are all rejected', () => {
  let state = createBattle({ seed: 'nan2', a: fighter(), b: fighter({ asset_id: '2' }) });
  state = step(state, { type: 'tick', toMs: 2000 }).state;
  const healthy = state.clockMs;
  for (const bad of [undefined, NaN, 'soon', {}, [], Infinity]) {
    const result = step(state, { type: 'tick', toMs: bad });
    assert.ok(Number.isFinite(result.state.clockMs), `toMs=${String(bad)} produced a non-finite clock`);
    assert.equal(result.state.clockMs, healthy, `toMs=${String(bad)} moved the clock`);
  }
});

test('a battle still finishes after a malformed tick is rejected', () => {
  let state = createBattle({ seed: 'recover', a: fighter(), b: fighter({ asset_id: '2' }) });
  state = step(state, { type: 'tick' }).state;
  state = step(state, { type: 'tick', toMs: NaN }).state;
  let now = state.clockMs;
  for (let i = 0; i < 20_000 && state.phase !== 'ended'; i++) {
    now += MAX_TICK_STEP_MS;
    state = step(state, { type: 'tick', toMs: now }).state;
  }
  assert.equal(state.phase, 'ended');
  assert.ok(state.clockMs < MAX_BATTLE_MS);
});

// ── Finding 4: the press time must be the server's, never the client's claim ───────

test('a client cannot claim a press time it has not reached yet', () => {
  const event = reflexStrike;
  const init = event.init(hashSeed('timetravel'), {});
  // Arrives 1ms into the window, but claims to have pressed on the sweet spot.
  const cheated = event.reduce(init.value, {
    player: 'a',
    payload: { pressAtMs: init.value.sweetSpotMs },
    atMs: 1,
  });
  assert.ok(
    event.score(cheated).a < 0.5,
    'scoring trusted payload.pressAtMs instead of the arrival time',
  );
});

test('timing events score the moment the input actually arrived', () => {
  const init = reflexStrike.init(hashSeed('honest'), {});
  const onTime = reflexStrike.reduce(init.value, {
    player: 'a',
    payload: {},
    atMs: init.value.sweetSpotMs,
  });
  assert.equal(reflexStrike.score(onTime).a, 1);
});

test('targeting lock also uses arrival time', () => {
  const init = targetingLock.init(hashSeed('target-sec'), {});
  const perfect = targetingLock.timeAtPosition(init.value, init.value.weakPoint);
  const stopped = targetingLock.reduce(init.value, { player: 'a', payload: {}, atMs: perfect });
  assert.ok(targetingLock.score(stopped).a > 0.99);
});

test('sequence lock speed is measured against the event window, not the battle clock', () => {
  // In a real battle input arrives with a battle-clock timestamp in the tens of
  // thousands. If that is used raw against a 5000ms window, speed is always zero.
  const init = sequenceLock.init(hashSeed('seq-sec'), {});
  const quick = sequenceLock.reduce(init.value, { player: 'a', payload: { keys: init.value.sequence }, atMs: 200 });
  assert.ok(sequenceLock.score(quick).a > 0.95, 'a fast, perfect entry should score near the top');
});

// ── Finding 7: seeds that are not strings ──────────────────────────────────────────

test('numeric seeds do not all collapse to one random stream', () => {
  assert.notEqual(hashSeed(101), hashSeed(202));
  const first = nextRandom(hashSeed(101)).value;
  const second = nextRandom(hashSeed(202)).value;
  assert.notEqual(first, second);
});

test('a null or undefined seed does not throw', () => {
  assert.doesNotThrow(() => hashSeed(null));
  assert.doesNotThrow(() => hashSeed(undefined));
});

test('battles created with different numeric ids play out differently', () => {
  const run = (seed) => {
    let state = createBattle({ seed, a: fighter(), b: fighter({ asset_id: '2' }) });
    const events = [];
    let now = 0;
    for (let i = 0; i < 20_000 && state.phase !== 'ended'; i++) {
      now += MAX_TICK_STEP_MS;
      const result = step(state, { type: 'tick', toMs: now });
      state = result.state;
      events.push(...result.events);
    }
    return events;
  };
  assert.notDeepEqual(run(101), run(202));
});

// ── Finding 3: every surge change must reach the client as an event ───────────────

test('the surge meter can be rebuilt exactly from the event stream', () => {
  for (const seed of ['surge-a', 'surge-b', 'surge-c', 'surge-d']) {
    let state = createBattle({
      seed,
      a: toFighter({
        asset_id: '1', name: 'Bot', clan: 'Onerion', core_power: 296,
        immutable_data: {
          cp: '296', element: 'Fire', 'attack star': '3', 'defense star': '3',
          'hp star': '5', 'pvp ready': '1', 'modules equipped': '5',
        },
      }, { posture: 'defensive' }),
      b: toFighter({
        asset_id: '2', name: 'Bot', clan: 'Zeronex', core_power: 296,
        immutable_data: {
          cp: '296', element: 'Water', 'attack star': '3', 'defense star': '3',
          'hp star': '5', 'pvp ready': '1', 'modules equipped': '5',
        },
      }, { posture: 'defensive' }),
    });

    const client = [0, 0];
    let now = 0;
    for (let i = 0; i < 20_000 && state.phase !== 'ended'; i++) {
      now += MAX_TICK_STEP_MS;
      const result = step(state, { type: 'tick', toMs: now });
      state = result.state;
      for (const event of result.events) {
        if (event.type === 'surge') client[event.fighter] = event.charges;
      }
    }
    assert.deepEqual(
      client,
      [state.fighters[0].surge, state.fighters[1].surge],
      `seed ${seed}: the client's surge meter drifted from authoritative state`,
    );
  }
});

// ── Finding 5: an empty buff must not wipe an unspent one ─────────────────────────

test('a later event handing out no buff leaves an unspent buff alone', () => {
  const granting = Object.freeze({
    id: 'granting', durationMs: 1000, momentumShift: 0.1,
    init: (rngState) => ({ value: {}, state: rngState }),
    reduce: (eventState) => eventState,
    score: () => ({ a: 0.5, b: 0.5, buffs: { a: { atkMult: 1.45 }, b: {} } }),
  });
  const empty = Object.freeze({
    id: 'empty', durationMs: 1000, momentumShift: 0.1,
    init: (rngState) => ({ value: {}, state: rngState }),
    reduce: (eventState) => eventState,
    score: () => ({ a: 0.5, b: 0.5, buffs: { a: {}, b: {} } }),
  });

  let state = createBattle({
    seed: 'buff-wipe',
    a: fighter(),
    b: fighter({ asset_id: '2' }),
    clashRegistry: { events: { granting: granting, empty }, weights: { granting: 1 } },
  });

  state = advanceUntil(state, (s) => s.phase === 'clash');
  state = advanceUntil(state, (s) => s.fighters[0].pendingBuff !== null);
  assert.deepEqual(state.fighters[0].pendingBuff, { atkMult: 1.45 });

  const actionsBefore = state.fighters[0].actionsTaken;
  // Swap in the event that grants nothing, then run another clash.
  state = { ...state, registry: { events: { granting, empty }, weights: { empty: 1 } } };
  state = advanceUntil(state, (s) => s.phase === 'clash');
  state = advanceUntil(state, (s) => s.phase !== 'clash');

  if (state.fighters[0].actionsTaken === actionsBefore) {
    assert.deepEqual(
      state.fighters[0].pendingBuff,
      { atkMult: 1.45 },
      'an empty buff wiped a buff its owner had not spent yet',
    );
  }
});

// ── Finding 6: a state restored without rehydrate must fail fast and clearly ──────

test('stepping a state restored without rehydrate fails with an actionable error', () => {
  let state = createBattle({ seed: 'restore', a: fighter(), b: fighter({ asset_id: '2' }) });
  state = step(state, { type: 'tick', toMs: 250 }).state;
  const restored = JSON.parse(JSON.stringify(state));
  assert.throws(
    () => step(restored, { type: 'tick', toMs: 500 }),
    /rehydrate/i,
    'a battle restored without rehydrate() should say so, not crash later inside an event',
  );
});
