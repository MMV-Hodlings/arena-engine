import test from 'node:test';
import assert from 'node:assert';
import { createBattle, step } from './battle.js';
import { toFighter } from './stats.js';
import { MAX_TICK_STEP_MS, MOMENTUM_SHIFT } from './constants.js';

const fighter = (over = {}) =>
  toFighter(
    {
      asset_id: over.asset_id ?? '1',
      name: 'Bot',
      clan: 'Onerion',
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
    },
    { posture: over.posture ?? 'balanced' },
  );

/** An event that always fires, always scores the same, and draws no randomness. */
const scripted = (scoreResult, overrides = {}) =>
  Object.freeze({
    id: 'scripted',
    durationMs: 2000,
    momentumShift: MOMENTUM_SHIFT,
    init: (rngState) => ({ value: { inputs: [] }, state: rngState }),
    reduce: (eventState, input) => ({ ...eventState, inputs: [...eventState.inputs, input] }),
    score: () => scoreResult,
    ...overrides,
  });

function battleWith(event, seed = 'clash') {
  const registry = { [event.id]: event };
  return createBattle({
    seed,
    a: fighter(),
    b: fighter({ asset_id: '2' }),
    clashRegistry: { events: registry, weights: { [event.id]: 1 } },
  });
}

/** Advances in fixed slices until a predicate holds or the budget runs out. */
function advanceUntil(state, predicate, { sliceMs = MAX_TICK_STEP_MS, limit = 4000 } = {}) {
  const events = [];
  let now = state.clockMs;
  for (let i = 0; i < limit; i++) {
    if (predicate(state, events)) break;
    now += sliceMs;
    const result = step(state, { type: 'tick', toMs: now });
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

test('a clash event freezes the fight and announces itself', () => {
  const { state, events } = advanceUntil(
    battleWith(scripted({ a: 1, b: 0 })),
    (s) => s.phase === 'clash',
  );
  assert.equal(state.phase, 'clash');
  assert.ok(state.clash);
  assert.equal(state.clash.id, 'scripted');
  const start = events.find((e) => e.type === 'clashStart');
  assert.ok(start);
  assert.equal(start.id, 'scripted');
  assert.ok(start.endsAt > start.t);
});

test('no action resolves while the fight is frozen', () => {
  const { state } = advanceUntil(battleWith(scripted({ a: 1, b: 0 })), (s) => s.phase === 'clash');
  const result = step(state, { type: 'tick', toMs: state.clockMs + MAX_TICK_STEP_MS });
  assert.equal(result.events.filter((e) => e.type === 'action').length, 0);
});

test('the event resolves when its window closes and momentum moves', () => {
  const { state } = advanceUntil(battleWith(scripted({ a: 1, b: 0 })), (s) => s.phase === 'clash');
  const { state: after, events } = advanceUntil(state, (s) => s.phase !== 'clash');
  const end = events.find((e) => e.type === 'clashEnd');
  assert.ok(end);
  assert.deepEqual(end.scores, { a: 1, b: 0 });
  assert.ok(Math.abs(after.fighters[0].momentum - 1.1) < 1e-9);
  assert.ok(Math.abs(after.fighters[1].momentum - 0.9) < 1e-9);
  assert.equal(after.phase, 'fighting');
  assert.equal(after.clash, null);
});

test('the pause does not cause a burst of actions when the fight resumes', () => {
  const { state } = advanceUntil(battleWith(scripted({ a: 0.5, b: 0.5 })), (s) => s.phase === 'clash');
  const { state: after } = advanceUntil(state, (s) => s.phase !== 'clash');
  const resumeEvents = step(after, { type: 'tick', toMs: after.clockMs + MAX_TICK_STEP_MS }).events;
  assert.ok(resumeEvents.filter((e) => e.type === 'action').length <= 1);
});

test('player input reaches the event and is recorded', () => {
  const { state } = advanceUntil(battleWith(scripted({ a: 0.5, b: 0.5 })), (s) => s.phase === 'clash');
  const result = step(state, {
    type: 'clashInput', player: 'a', payload: { taps: 3 }, atMs: state.clockMs + 100,
  });
  assert.equal(result.state.clash.eventState.inputs.length, 1);
});

// Review Focus 3: input outside the window must be ignored, not mutate state.
test('input before the event opened is ignored', () => {
  const { state } = advanceUntil(battleWith(scripted({ a: 0.5, b: 0.5 })), (s) => s.phase === 'clash');
  const result = step(state, {
    type: 'clashInput', player: 'a', payload: { taps: 1 }, atMs: state.clash.startedAt - 1,
  });
  assert.equal(result.state.clash.eventState.inputs.length, 0);
  assert.deepEqual(result.events, []);
});

test('input after the window closed is ignored', () => {
  const { state } = advanceUntil(battleWith(scripted({ a: 0.5, b: 0.5 })), (s) => s.phase === 'clash');
  const result = step(state, {
    type: 'clashInput', player: 'a', payload: { taps: 1 }, atMs: state.clash.endsAt + 1,
  });
  assert.equal(result.state.clash.eventState.inputs.length, 0);
});

test('input while no event is running is ignored', () => {
  const state = battleWith(scripted({ a: 0.5, b: 0.5 }));
  const result = step(state, { type: 'clashInput', player: 'a', payload: {}, atMs: 10 });
  assert.equal(result.state, state);
  assert.deepEqual(result.events, []);
});

test('input from an unknown player is ignored', () => {
  const { state } = advanceUntil(battleWith(scripted({ a: 0.5, b: 0.5 })), (s) => s.phase === 'clash');
  const result = step(state, {
    type: 'clashInput', player: 'c', payload: { taps: 1 }, atMs: state.clockMs + 10,
  });
  assert.equal(result.state.clash.eventState.inputs.length, 0);
});

test('a bonus hit from an event damages the named fighter', () => {
  const event = scripted({ a: 1, b: 0, bonusHit: { target: 1, mult: 0.5 } });
  const { state } = advanceUntil(battleWith(event), (s) => s.phase === 'clash');
  const hpBefore = state.fighters[1].hp;
  const { state: after } = advanceUntil(state, (s) => s.phase !== 'clash');
  assert.ok(after.fighters[1].hp < hpBefore);
});

test('buffs from an event apply to the next action and then expire', () => {
  const event = scripted({ a: 0.5, b: 0.5, buffs: { a: { atkMult: 1.3, surge: 2 }, b: {} } });
  const { state } = advanceUntil(battleWith(event), (s) => s.phase === 'clash');
  const { state: after } = advanceUntil(state, (s) => s.phase !== 'clash');
  assert.equal(after.fighters[0].surge >= 2, true);
  assert.deepEqual(after.fighters[0].pendingBuff, { atkMult: 1.3, surge: 2 });
  const { state: later } = advanceUntil(
    after,
    (s) => s.fighters[0].actionsTaken > after.fighters[0].actionsTaken,
  );
  assert.equal(later.fighters[0].pendingBuff, null);
});

test('a read exchange deals damage to both sides when both commit', () => {
  const event = scripted({ a: 0.5, b: 0.5, exchange: { a: 'overload', b: 'overload' } });
  const { state } = advanceUntil(battleWith(event), (s) => s.phase === 'clash');
  const before = state.fighters.map((f) => f.hp);
  const { state: after } = advanceUntil(state, (s) => s.phase !== 'clash');
  assert.ok(after.fighters[0].hp < before[0]);
  assert.ok(after.fighters[1].hp < before[1]);
});

test('clash events stay deterministic across identical runs', () => {
  const run = () => {
    const { state, events } = advanceUntil(
      battleWith(scripted({ a: 1, b: 0 }), 'determinism'),
      (s) => s.phase === 'ended',
      { limit: 8000 },
    );
    return { winner: state.winner, events };
  };
  assert.deepEqual(run(), run());
});

test('a defensive buff is spent on the first hit it absorbs', () => {
  const event = scripted({ a: 0.5, b: 0.5, buffs: { a: {}, b: { defMult: 1.45 } } });
  const { state } = advanceUntil(battleWith(event), (s) => s.phase === 'clash');
  const { state: after } = advanceUntil(state, (s) => s.phase !== 'clash');
  assert.deepEqual(after.fighters[1].pendingBuff, { defMult: 1.45 });
  const { state: later } = advanceUntil(
    after,
    (s) => s.fighters[1].pendingBuff === null || s.phase === 'ended',
    { limit: 400 },
  );
  assert.equal(later.fighters[1].pendingBuff, null);
});

test('a clash announces what the client may draw', () => {
  const event = scripted({ a: 0.5, b: 0.5 }, {
    publicState: (eventState) => ({ drawable: true, taps: eventState.inputs.length }),
  });
  const { events } = advanceUntil(battleWith(event), (s) => s.phase === 'clash');
  const start = events.find((frame) => frame.type === 'clashStart');
  assert.ok(start.public, 'clashStart carried no public state');
  assert.equal(start.public.drawable, true);
});

test('an event with no publicState still starts cleanly', () => {
  const bare = Object.freeze({
    id: 'bare',
    durationMs: 1000,
    momentumShift: MOMENTUM_SHIFT,
    init: (rngState) => ({ value: {}, state: rngState }),
    reduce: (eventState) => eventState,
    score: () => ({ a: 0.5, b: 0.5 }),
  });
  const { events } = advanceUntil(battleWith(bare), (s) => s.phase === 'clash');
  assert.deepEqual(events.find((frame) => frame.type === 'clashStart').public, {});
});
