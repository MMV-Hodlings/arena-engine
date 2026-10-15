import test from 'node:test';
import assert from 'node:assert';
import { planClashInputs, choosePosture } from './ai.js';
import { CLASH_EVENTS } from './events/index.js';
import { hashSeed } from './rng.js';
import { resolveStances } from './actions.js';

/** Builds the clash record the reducer would hold for a given event. */
function clashFor(id, seed = 'ai') {
  const event = CLASH_EVENTS[id];
  const init = event.init(hashSeed(seed), { heavyBy: 0 });
  return { id, eventState: init.value, startedAt: 10_000, endsAt: 10_000 + event.durationMs };
}

/** Runs the planned inputs through the event and returns the resulting score. */
function scoreOf(id, inputs, clash) {
  const event = CLASH_EVENTS[id];
  let eventState = clash.eventState;
  for (const input of inputs) {
    eventState = event.reduce(eventState, { ...input, atMs: input.atMs - clash.startedAt });
  }
  return event.score(eventState);
}

test('every registered event can be played by the AI', () => {
  for (const id of Object.keys(CLASH_EVENTS)) {
    const clash = clashFor(id);
    const planned = planClashInputs(clash, 'b', { competence: 0.8 }, hashSeed(`plan-${id}`));
    assert.ok(Array.isArray(planned.value), `${id} produced no input list`);
    for (const input of planned.value) {
      assert.equal(input.player, 'b');
      assert.ok(input.atMs >= clash.startedAt && input.atMs <= clash.endsAt, `${id} planned input outside the window`);
    }
  }
});

test('a competent AI scores better than an incompetent one, on every event', () => {
  for (const id of Object.keys(CLASH_EVENTS)) {
    // powerRouting scores a flat 0.5 by design, and the Read is a simultaneous symmetric
    // guess — see the fairness test below, which proves no stance can be played "better"
    // in isolation. Neither is an execution event, so competence cannot move them.
    if (id === 'powerRouting' || id === 'read') continue;
    let good = 0;
    let bad = 0;
    for (let i = 0; i < 25; i++) {
      const clash = clashFor(id, `seed-${i}`);
      good += scoreOf(id, planClashInputs(clash, 'b', { competence: 1 }, hashSeed(`g${i}`)).value, clash).b;
      bad += scoreOf(id, planClashInputs(clash, 'b', { competence: 0 }, hashSeed(`b${i}`)).value, clash).b;
    }
    assert.ok(good > bad, `${id}: competent ${good.toFixed(2)} did not beat incompetent ${bad.toFixed(2)}`);
  }
});

test('a maximally competent AI scores near the top', () => {
  const clash = clashFor('reflexStrike');
  const planned = planClashInputs(clash, 'b', { competence: 1 }, hashSeed('perfect'));
  assert.ok(scoreOf('reflexStrike', planned.value, clash).b > 0.85);
});

test('the AI never exceeds the tap clamp', () => {
  const clash = clashFor('tugOfWar');
  const planned = planClashInputs(clash, 'b', { competence: 1 }, hashSeed('taps'));
  for (const input of planned.value) {
    const rate = input.payload.taps / (input.payload.windowMs / 1000);
    assert.ok(rate <= 12 + 1e-9, `planned ${rate} taps per second`);
  }
});

test('planning is deterministic for a given rng state', () => {
  const clash = clashFor('sequenceLock');
  const first = planClashInputs(clash, 'a', { competence: 0.6 }, hashSeed('same'));
  const second = planClashInputs(clash, 'a', { competence: 0.6 }, hashSeed('same'));
  assert.deepEqual(first.value, second.value);
  assert.equal(first.state, second.state);
});

test('an unknown event id plans nothing rather than throwing', () => {
  const planned = planClashInputs({ id: 'nope', eventState: {}, startedAt: 0, endsAt: 1000 }, 'a', { competence: 1 }, hashSeed('x'));
  assert.deepEqual(planned.value, []);
});

test('posture selection returns a real posture', () => {
  const chosen = choosePosture(hashSeed('posture'), { competence: 0.5 });
  assert.ok(['aggressive', 'balanced', 'defensive'].includes(chosen.value));
});

test('the stance triangle has no dominant option, so a Read cannot be out-skilled in isolation', () => {
  // This is why the competence test above excludes the Read. Every stance has the same
  // expected score against a uniform opponent: the only edge available is reading the
  // person, which is exactly what the spec intends by leaving reads outside the skill cap.
  const stances = ['strike', 'guard', 'overload'];
  for (const mine of stances) {
    let total = 0;
    for (const theirs of stances) {
      const resolved = resolveStances(mine, theirs);
      total += resolved.outcome === 'tie' ? 0.5 : resolved.outcome === 'a' ? 1 : 0;
    }
    assert.ok(Math.abs(total / stances.length - 0.5) < 1e-9, `${mine} is dominant or dominated`);
  }
});
