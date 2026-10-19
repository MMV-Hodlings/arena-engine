import test from 'node:test';
import assert from 'node:assert';
import { createBattle, step } from './battle.js';
import { toFighter } from './stats.js';
import { MAX_TICK_STEP_MS, MOMENTUM_SHIFT, OMEN_MS, BRIEFING_MS } from './constants.js';
import { read } from './events/read.js';

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

test('two guards bank a Surge charge each instead of nothing happening', () => {
  // Spec section 3.7 says mutual guard deals no damage and both gain a Surge charge. The
  // charge was never implemented, which left this the one exchange where the battle simply
  // paused. After the 2026-10-19 rebalance guard is ~39% of optimal play, so the mirror is
  // ~15% of all Reads and the dead exchange mattered.
  let { state } = advanceUntil(battleWith(read), (s) => s.phase === 'clash');
  const hpBefore = state.fighters.map((f) => f.hp);

  for (const player of ['a', 'b']) {
    const result = step(state, {
      type: 'clashInput', player, payload: { stance: 'guard' }, atMs: state.clockMs + 100,
    });
    state = result.state;
  }

  const after = advanceUntil(state, (s) => s.phase !== 'clash');
  const surges = after.events.filter((e) => e.type === 'surge');

  assert.equal(surges.length, 2, 'both robots bank a charge');
  assert.deepEqual(after.state.fighters.map((f) => f.surge), [1, 1]);
  assert.deepEqual(after.state.fighters.map((f) => f.hp), hpBefore, 'and neither takes damage');
});

test('a decided Read banks no Surge charge', () => {
  // The charge is the reward for a stand-off specifically, not for any exchange.
  let { state } = advanceUntil(battleWith(read), (s) => s.phase === 'clash');
  state = step(state, { type: 'clashInput', player: 'a', payload: { stance: 'overload' }, atMs: state.clockMs + 100 }).state;
  state = step(state, { type: 'clashInput', player: 'b', payload: { stance: 'guard' }, atMs: state.clockMs + 100 }).state;

  const after = advanceUntil(state, (s) => s.phase !== 'clash');
  assert.equal(after.events.filter((e) => e.type === 'surge').length, 0);
});

// ── The battle pacing design: omens, briefings and decision windows that close early ──

test('an event is foreshadowed: its omen comes OMEN_MS before it, and no action lands between', () => {
  const { events } = advanceUntil(battleWith(scripted({ a: 1, b: 0 })), (s) => s.phase === 'clash');
  const omen = events.find((e) => e.type === 'omen');
  const start = events.find((e) => e.type === 'clashStart');
  assert.ok(omen, 'no omen before the event');
  assert.equal(omen.id, 'scripted');
  assert.equal(start.t - omen.t, OMEN_MS);
  assert.equal(events.filter((e) => e.type === 'action' && e.t > omen.t).length, 0);
  assert.equal(omen.fighter, events.filter((e) => e.type === 'action' && e.t <= omen.t).at(-1).fighter);
});

test('clash input during the omen changes nothing', () => {
  const { state } = advanceUntil(battleWith(scripted({ a: 0.5, b: 0.5 })), (s) => s.phase === 'omen');
  assert.equal(state.phase, 'omen', 'no omen phase was reached');
  const result = step(state, { type: 'clashInput', player: 'a', payload: {}, atMs: state.clockMs });
  assert.equal(result.state, state);
  assert.deepEqual(result.events, []);
});

test('a briefed event announces itself, then opens input BRIEFING_MS later', () => {
  const event = scripted({ a: 0.5, b: 0.5 }, { briefingMs: BRIEFING_MS });
  const { state, events } = advanceUntil(battleWith(event), (s) => s.phase === 'clash');
  const start = events.find((e) => e.type === 'clashStart');
  assert.equal(start.announcedAt, start.t);
  assert.equal(start.startedAt - start.announcedAt, BRIEFING_MS);
  assert.equal(start.endsAt - start.startedAt, event.durationMs);
  const early = step(state, { type: 'clashInput', player: 'a', payload: {}, atMs: start.startedAt - 1 });
  assert.equal(early.state.clash.eventState.inputs.length, 0);
  const onTime = step(state, { type: 'clashInput', player: 'a', payload: {}, atMs: start.startedAt });
  assert.equal(onTime.state.clash.eventState.inputs.length, 1);
});

test('an event with no briefing opens input as it is announced', () => {
  const { events } = advanceUntil(battleWith(scripted({ a: 0.5, b: 0.5 })), (s) => s.phase === 'clash');
  const start = events.find((e) => e.type === 'clashStart');
  assert.equal(start.announcedAt, start.t);
  assert.equal(start.startedAt, start.announcedAt);
});

test('the fight stays frozen from the omen to the close, then resumes without a burst', () => {
  const { events } = advanceUntil(battleWith(scripted({ a: 0.5, b: 0.5 })), (s, seen) => {
    const end = seen.find((e) => e.type === 'clashEnd');
    return !!end && seen.filter((e) => e.type === 'action' && e.t >= end.t).length >= 2;
  });
  const omen = events.find((e) => e.type === 'omen');
  const end = events.find((e) => e.type === 'clashEnd');
  assert.ok(omen && end, 'no event ran to its close');
  assert.equal(events.filter((e) => e.type === 'action' && e.t > omen.t && e.t < end.t).length, 0);
  const after = events.filter((e) => e.type === 'action' && e.t >= end.t);
  assert.ok(after.length >= 2 && after[1].t - after[0].t >= 2000);
});

const decision = () => scripted({ a: 0.5, b: 0.5 }, { durationMs: 15_000, settled: (s) => s.inputs.length >= 2 });

test('a settled event closes at the moment it settles', () => {
  let { state } = advanceUntil(battleWith(decision()), (s) => s.phase === 'clash');
  const opened = state.clash.startedAt;
  state = step(state, { type: 'clashInput', player: 'a', payload: {}, atMs: opened + 1000 }).state;
  assert.equal(state.clash.endsAt, opened + 15_000);
  state = step(state, { type: 'clashInput', player: 'b', payload: {}, atMs: opened + 3000 }).state;
  assert.equal(state.clash.endsAt, opened + 3000);
  const ends = advanceUntil(state, (s) => s.phase !== 'clash').events.filter((e) => e.type === 'clashEnd');
  assert.equal(ends.length, 1);
  assert.equal(ends[0].t, opened + 3000);
});

test('one commit alone runs the whole window', () => {
  let { state } = advanceUntil(battleWith(decision()), (s) => s.phase === 'clash');
  const opened = state.clash.startedAt;
  state = step(state, { type: 'clashInput', player: 'a', payload: {}, atMs: opened + 1000 }).state;
  const ends = advanceUntil(state, (s) => s.phase !== 'clash').events.filter((e) => e.type === 'clashEnd');
  assert.equal(ends.length, 1);
  assert.equal(ends[0].t, opened + 15_000);
});

test('a commit at the last moment of the window closes it once', () => {
  let { state } = advanceUntil(battleWith(decision()), (s) => s.phase === 'clash');
  const opened = state.clash.startedAt;
  state = step(state, { type: 'clashInput', player: 'a', payload: {}, atMs: opened + 1000 }).state;
  state = step(state, { type: 'clashInput', player: 'b', payload: {}, atMs: opened + 15_000 }).state;
  const ends = advanceUntil(state, (s) => s.phase !== 'clash').events.filter((e) => e.type === 'clashEnd');
  assert.equal(ends.length, 1);
  assert.equal(ends[0].t, opened + 15_000);
});

// Deferred minor #9: the push-back is the whole pause, the hint included. Asserted directly,
// because MIN_BLOW_GAP_MS alone would hide a push measured from the window's opening instead.
test('both gauges are pushed back by the whole pause, from the hint to the close', () => {
  let { state } = advanceUntil(battleWith(scripted({ a: 0.5, b: 0.5 })), (s) => s.phase === 'omen');
  const before = state.fighters.map((f) => f.nextActionAt);
  const omenAt = state.omen.startedAt;
  const { state: after, events } = advanceUntil(state, (s) => s.phase === 'fighting');
  const end = events.find((e) => e.type === 'clashEnd');
  assert.ok(end, 'the event never closed');
  assert.ok(end.t - omenAt >= OMEN_MS, 'the pause should include the hint');
  assert.deepEqual(after.fighters.map((f) => f.nextActionAt), before.map((at) => at + (end.t - omenAt)));
});
