import test from 'node:test';
import assert from 'node:assert';
import { ACTION_MULT, chooseAction, resolveStances } from './actions.js';
import { hashSeed } from './rng.js';

const ctx = (over = {}) => ({
  posture: 'balanced', hpFraction: 1, surgeCharges: 0, element: 'Fire', statuses: [], ...over,
});

test('action multipliers match the spec', () => {
  assert.equal(ACTION_MULT.strike, 1);
  assert.equal(ACTION_MULT.overload, 1.6);
  assert.equal(ACTION_MULT.guard, 0);
  assert.equal(ACTION_MULT.surge, 1.3);
  assert.equal(ACTION_MULT.counter, 0.6);
});

test('a frozen robot can only guard', () => {
  const chosen = chooseAction(hashSeed('frozen'), ctx({ statuses: [{ id: 'freeze', remaining: 1 }] }));
  assert.equal(chosen.value, 'guard');
});

test('surge is only chosen with enough charges and a real element', () => {
  let sawSurge = false;
  let state = hashSeed('surge');
  for (let i = 0; i < 200; i++) {
    const chosen = chooseAction(state, ctx({ surgeCharges: 3 }));
    if (chosen.value === 'surge') sawSurge = true;
    state = chosen.state;
  }
  assert.ok(sawSurge, 'surge was never chosen with full charges');

  state = hashSeed('no-element');
  for (let i = 0; i < 200; i++) {
    const chosen = chooseAction(state, ctx({ surgeCharges: 5, element: 'Neutral' }));
    assert.notEqual(chosen.value, 'surge');
    state = chosen.state;
  }
});

test('an aggressive posture attacks more than a defensive one', () => {
  const count = (posture) => {
    let state = hashSeed(`posture-${posture}`);
    let guards = 0;
    for (let i = 0; i < 400; i++) {
      const chosen = chooseAction(state, ctx({ posture }));
      if (chosen.value === 'guard') guards++;
      state = chosen.state;
    }
    return guards;
  };
  assert.ok(count('defensive') > count('aggressive') * 2);
});

test('a reeling robot guards more than a healthy one', () => {
  const count = (hpFraction) => {
    let state = hashSeed(`hp-${hpFraction}`);
    let guards = 0;
    for (let i = 0; i < 400; i++) {
      const chosen = chooseAction(state, ctx({ hpFraction }));
      if (chosen.value === 'guard') guards++;
      state = chosen.state;
    }
    return guards;
  };
  assert.ok(count(0.1) > count(1));
});

test('choosing an action is deterministic for a given state', () => {
  assert.equal(chooseAction(hashSeed('same'), ctx()).value, chooseAction(hashSeed('same'), ctx()).value);
});

test('strike interrupts overload', () => {
  const result = resolveStances('strike', 'overload');
  assert.equal(result.outcome, 'a');
  assert.equal(result.a.damageMult, 1);
  assert.ok(Math.abs(result.b.damageMult - 0.8) < 1e-9);
});

test('overload breaks guard for full damage', () => {
  const result = resolveStances('overload', 'guard');
  assert.equal(result.outcome, 'a');
  assert.equal(result.a.damageMult, 1.6);
  assert.equal(result.b.damageMult, 0);
  assert.equal(result.b.takenMult, 1, 'a broken guard gives no reduction');
});

test('guard parries strike and counters', () => {
  const result = resolveStances('guard', 'strike');
  assert.equal(result.outcome, 'a');
  assert.ok(Math.abs(result.a.damageMult - 0.6) < 1e-9, 'the parrying robot counters');
  assert.ok(Math.abs(result.b.takenMult - 1) < 1e-9);
  assert.ok(Math.abs(result.a.takenMult - 0.5) < 1e-9, 'the parried strike is halved');
  assert.equal(result.b.damageMult, 1);
});

test('mutual overload is devastating for both', () => {
  const result = resolveStances('overload', 'overload');
  assert.equal(result.outcome, 'tie');
  assert.equal(result.a.damageMult, 1.6);
  assert.equal(result.b.damageMult, 1.6);
  assert.ok(Math.abs(result.a.takenMult - 1.4) < 1e-9);
  assert.ok(Math.abs(result.b.takenMult - 1.4) < 1e-9);
});

test('mutual guard does nothing at all', () => {
  const result = resolveStances('guard', 'guard');
  assert.equal(result.outcome, 'tie');
  assert.equal(result.a.damageMult, 0);
  assert.equal(result.b.damageMult, 0);
});

test('the triangle is symmetric however the arguments are ordered', () => {
  const forward = resolveStances('strike', 'overload');
  const reverse = resolveStances('overload', 'strike');
  assert.equal(reverse.outcome, 'b');
  assert.equal(reverse.b.damageMult, forward.a.damageMult);
  assert.equal(reverse.a.damageMult, forward.b.damageMult);
});
