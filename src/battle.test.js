import test from 'node:test';
import assert from 'node:assert';
import { createBattle, step } from './battle.js';
import { toFighter } from './stats.js';
import { INTRO_MS, MAX_TICK_STEP_MS, MAX_BATTLE_MS, ENGINE_VERSION } from './constants.js';

const chassis = (over = {}) => ({
  asset_id: over.asset_id ?? '1',
  name: over.name ?? 'Onerion',
  clan: over.clan ?? 'Onerion',
  core_power: over.cp ?? 296,
  immutable_data: {
    cp: String(over.cp ?? 296),
    element: over.element ?? 'Neutral',
    'attack star': String(over.attack ?? 3),
    'defense star': String(over.defense ?? 3),
    'hp star': String(over.hp ?? 3),
    'pvp ready': '1',
    'modules equipped': '5',
  },
});

const fighter = (over = {}) => toFighter(chassis(over), { posture: over.posture ?? 'balanced' });

/**
 * Walks the clock forward to an absolute time. One step advances at most
 * MAX_TICK_STEP_MS, so reaching an arbitrary moment takes repeated calls — which is
 * exactly how the Durable Object will drive it.
 */
function advanceClock(state, toMs) {
  const events = [];
  while (state.clockMs < toMs && state.phase !== 'ended') {
    const result = step(state, { type: 'tick', toMs });
    if (result.state.clockMs === state.clockMs) break;
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

/** Runs a battle to its end in fixed slices, collecting every event. */
function runToEnd(state, { sliceMs = MAX_TICK_STEP_MS, limit = 20_000 } = {}) {
  const events = [];
  let now = 0;
  for (let i = 0; i < limit && state.phase !== 'ended'; i++) {
    now += sliceMs;
    const result = step(state, { type: 'tick', toMs: now });
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

test('a new battle starts in the intro phase with full HP', () => {
  const state = createBattle({ seed: 'battle-1', a: fighter(), b: fighter({ asset_id: '2' }) });
  assert.equal(state.phase, 'intro');
  assert.equal(state.clockMs, 0);
  assert.equal(state.version, ENGINE_VERSION);
  assert.equal(state.fighters[0].hp, state.fighters[0].maxHp);
  assert.ok(state.fighters[0].maxHp > 0);
  assert.equal(state.winner, null);
});

test('max HP is cp x hp star, with the element multiplier applied', () => {
  const state = createBattle({
    seed: 'elements',
    a: fighter({ element: 'Fire' }),          // Fire beats Ice: 1.10
    b: fighter({ asset_id: '2', element: 'Ice' }),
  });
  assert.ok(Math.abs(state.fighters[0].maxHp - 296 * 1.1 * 3) < 1e-9);
  assert.ok(Math.abs(state.fighters[1].maxHp - 296 * 1 * 3) < 1e-9);
});

test('the fight starts once the intro is over', () => {
  const state = createBattle({ seed: 'intro', a: fighter(), b: fighter({ asset_id: '2' }) });
  const beforeIntroEnds = advanceClock(state, INTRO_MS - 1);
  assert.equal(beforeIntroEnds.state.phase, 'intro');
  assert.equal(beforeIntroEnds.state.clockMs, INTRO_MS - 1);
  const afterIntro = advanceClock(beforeIntroEnds.state, INTRO_MS);
  assert.equal(afterIntro.state.phase, 'fighting');
  assert.ok(afterIntro.events.some((e) => e.type === 'fightStart'));
});

test('the same seed and the same ticks produce an identical event stream', () => {
  const build = () => createBattle({ seed: 'determinism', a: fighter(), b: fighter({ asset_id: '2' }) });
  const first = runToEnd(build());
  const second = runToEnd(build());
  assert.deepEqual(first.events, second.events);
  assert.equal(first.state.winner, second.state.winner);
});

test('different seeds produce different battles', () => {
  const a = runToEnd(createBattle({ seed: 'seed-a', a: fighter(), b: fighter({ asset_id: '2' }) }));
  const b = runToEnd(createBattle({ seed: 'seed-b', a: fighter(), b: fighter({ asset_id: '2' }) }));
  assert.notDeepEqual(a.events, b.events);
});

test('a mirror match takes roughly ten landed hits per side', () => {
  const { events } = runToEnd(
    createBattle({ seed: 'mirror', a: fighter(), b: fighter({ asset_id: '2' }) }),
  );
  const hits = events.filter((e) => e.type === 'damage' && e.source === 'action' && e.amount > 0);
  assert.ok(hits.length >= 12 && hits.length <= 28, `mirror match landed ${hits.length} hits in total`);
});

test('pacing holds at every tier, not just mid CP', () => {
  for (const cp of [94, 296, 604.8]) {
    const { events } = runToEnd(
      createBattle({
        seed: `tier-${cp}`,
        a: fighter({ cp, attack: 5, defense: 5, hp: 5 }),
        b: fighter({ asset_id: '2', cp, attack: 5, defense: 5, hp: 5 }),
      }),
    );
    const hits = events.filter((e) => e.type === 'damage' && e.source === 'action' && e.amount > 0);
    assert.ok(hits.length >= 12 && hits.length <= 28, `cp ${cp} landed ${hits.length} hits`);
  }
});

test('a crushing mismatch is over almost immediately', () => {
  const { state, events } = runToEnd(
    createBattle({
      seed: 'mismatch',
      a: fighter({ cp: 604.8, attack: 5, defense: 5, hp: 5 }),
      b: fighter({ asset_id: '2', cp: 94, attack: 1, defense: 1, hp: 1 }),
    }),
  );
  assert.equal(state.winner, 0);
  const hits = events.filter((e) => e.type === 'damage' && e.source === 'action' && e.amount > 0);
  assert.ok(hits.length <= 4, `expected a rout, took ${hits.length} hits`);
});

test('every battle terminates', () => {
  for (let i = 0; i < 200; i++) {
    const seed = `termination-${i}`;
    const pick = (n) => ((i >> n) % 5) + 1;
    const { state } = runToEnd(
      createBattle({
        seed,
        a: fighter({ cp: 94 + (i % 500), attack: pick(0), defense: pick(1), hp: pick(2) }),
        b: fighter({ asset_id: '2', cp: 94 + ((i * 7) % 500), attack: pick(1), defense: pick(2), hp: pick(0) }),
      }),
    );
    assert.equal(state.phase, 'ended', `battle ${seed} never ended`);
    assert.ok(state.clockMs <= MAX_BATTLE_MS, `battle ${seed} ran past the hard ceiling`);
    assert.ok(['ko', 'timeout'].includes(state.endReason));
  }
});

test('sudden death is announced once and only once', () => {
  const { events } = runToEnd(
    createBattle({
      seed: 'sudden',
      a: fighter({ attack: 1, defense: 5, hp: 5, posture: 'defensive' }),
      b: fighter({ asset_id: '2', attack: 1, defense: 5, hp: 5, posture: 'defensive' }),
    }),
  );
  assert.equal(events.filter((e) => e.type === 'suddenDeath').length, 1);
});

test('a knockout ends the battle and nothing happens afterwards', () => {
  const { state } = runToEnd(
    createBattle({
      seed: 'ko',
      a: fighter({ cp: 604.8, attack: 5, defense: 5, hp: 5 }),
      b: fighter({ asset_id: '2', cp: 94, attack: 1, defense: 1, hp: 1 }),
    }),
  );
  assert.equal(state.phase, 'ended');
  const after = step(state, { type: 'tick', toMs: state.clockMs + 10_000 });
  assert.deepEqual(after.events, []);
  assert.equal(after.state.clockMs, state.clockMs);
});

// Review Focus 5: hibernation wake-ups and clock skew.
test('a backwards tick is ignored and never rewinds the clock', () => {
  const fresh = createBattle({ seed: 'backwards', a: fighter(), b: fighter({ asset_id: '2' }) });
  const state = advanceClock(fresh, 5000).state;
  const before = state.clockMs;
  assert.equal(before, 5000, 'the clock should have reached 5000 before ticking backwards');
  const result = step(state, { type: 'tick', toMs: 1000 });
  assert.equal(result.state.clockMs, before);
  assert.deepEqual(result.events, []);
});

test('a sixty-second jump advances at most one tick step and resolves at most one action', () => {
  let state = createBattle({ seed: 'hibernate', a: fighter(), b: fighter({ asset_id: '2' }) });
  state = step(state, { type: 'tick', toMs: INTRO_MS }).state;
  const before = state.clockMs;
  const result = step(state, { type: 'tick', toMs: before + 60_000 });
  assert.ok(result.state.clockMs <= before + MAX_TICK_STEP_MS);
  const actions = result.events.filter((e) => e.type === 'action');
  assert.ok(actions.length <= 1, `resolved ${actions.length} actions in one tick`);
});

test('an unknown input type is ignored', () => {
  const state = createBattle({ seed: 'unknown', a: fighter(), b: fighter({ asset_id: '2' }) });
  const result = step(state, { type: 'nonsense' });
  assert.deepEqual(result.events, []);
  assert.equal(result.state, state);
});

test('battle state survives a JSON round trip', () => {
  let state = createBattle({ seed: 'json', a: fighter(), b: fighter({ asset_id: '2' }) });
  state = step(state, { type: 'tick', toMs: 8000 }).state;
  const revived = JSON.parse(JSON.stringify(state));
  const fromOriginal = step(state, { type: 'tick', toMs: 12_000 });
  const fromRevived = step(revived, { type: 'tick', toMs: 12_000 });
  assert.deepEqual(fromRevived.events, fromOriginal.events);
});

test('guarding charges surge', () => {
  const { events } = runToEnd(
    createBattle({
      seed: 'surge-charge',
      a: fighter({ posture: 'defensive', element: 'Fire' }),
      b: fighter({ asset_id: '2', posture: 'defensive', element: 'Water' }),
    }),
  );
  assert.ok(events.some((e) => e.type === 'surge' && e.charges > 0));
});

test('an element surge applies the attacker element status to the defender', () => {
  const { events } = runToEnd(
    createBattle({
      seed: 'surge-status',
      a: fighter({ posture: 'defensive', element: 'Fire', attack: 2, defense: 5, hp: 5 }),
      b: fighter({ asset_id: '2', posture: 'defensive', element: 'Earth', attack: 2, defense: 5, hp: 5 }),
    }),
  );
  const statuses = events.filter((e) => e.type === 'status' && e.applied);
  assert.ok(statuses.length > 0, 'no status was ever applied across a long defensive battle');
});
