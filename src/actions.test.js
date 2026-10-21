import test from 'node:test';
import assert from 'node:assert';
import { ACTION_MULT, chooseAction, resolveStances, READY_GUARD_CUT } from './actions.js';
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

/**
 * What a matchup is worth to the winner, in units of base damage: what it lands minus what
 * it eats. This, not the raw multipliers, is what sets how often each stance is worth
 * picking, so it is what these tests assert.
 */
function netSwing(a, b) {
  const r = resolveStances(a, b);
  return r.a.damageMult * r.b.takenMult - r.b.damageMult * r.a.takenMult;
}

test('strike interrupts overload', () => {
  const result = resolveStances('strike', 'overload');
  assert.equal(result.outcome, 'a');
  assert.equal(result.a.damageMult, 1);
  assert.ok(Math.abs(result.b.damageMult - 0.75) < 1e-9, 'the interrupted swing lands short');
  assert.ok(Math.abs(result.b.takenMult - 1.25) < 1e-9, 'and leaves the overloader open');
  assert.ok(Math.abs(netSwing('strike', 'overload') - 0.5) < 1e-9);
});

test('overload beats a guard without erasing it', () => {
  const result = resolveStances('overload', 'guard');
  assert.equal(result.outcome, 'a');
  assert.equal(result.a.damageMult, 1.6);
  assert.ok(Math.abs(result.b.takenMult - 0.4) < 1e-9, 'the guard blunts the swing, it is not broken');
  assert.ok(Math.abs(result.b.damageMult - 0.15) < 1e-9, 'and chips back');
  // The old table gave the guard 0 damage and no reduction, a swing of 1.60 — which made
  // guard a trap rather than a stance. Keep this an edge, not an execution.
  assert.ok(Math.abs(netSwing('overload', 'guard') - 0.49) < 1e-9);
});

test('guard parries strike and counters', () => {
  const result = resolveStances('guard', 'strike');
  assert.equal(result.outcome, 'a');
  assert.ok(Math.abs(result.a.damageMult - 0.55) < 1e-9, 'the parrying robot counters');
  assert.ok(Math.abs(result.b.takenMult - 1) < 1e-9);
  assert.ok(Math.abs(result.a.takenMult - 0.25) < 1e-9, 'the parried strike is mostly absorbed');
  assert.equal(result.b.damageMult, 1);
  assert.ok(Math.abs(netSwing('guard', 'strike') - 0.3) < 1e-9);
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

test('a robot with a surge ready only surges or guards: every attack it makes is the surge', () => {
  for (const posture of ['aggressive', 'balanced', 'defensive']) {
    let state = hashSeed(`ready-${posture}`);
    const seen = { surge: 0, guard: 0, strike: 0, heavy: 0 };
    for (let i = 0; i < 4000; i++) {
      const chosen = chooseAction(state, ctx({ posture, surgeCharges: 3 }));
      state = chosen.state;
      seen[chosen.value] += 1;
    }
    assert.equal(seen.strike, 0, posture);
    assert.equal(seen.heavy, 0, posture);
    assert.ok(seen.surge > 0 && seen.guard > 0, posture);
  }
});

test('with a surge ready, a robot attacks as often as its posture always did, only with the surge', () => {
  // Balanced posture: strike 5 + heavy 2 against guard 2, so the surge is 7 in 9.
  let state = hashSeed('ready-share');
  let surges = 0;
  const draws = 20000;
  for (let i = 0; i < draws; i++) {
    const chosen = chooseAction(state, ctx({ posture: 'balanced', surgeCharges: 3 }));
    state = chosen.state;
    if (chosen.value === 'surge') surges += 1;
  }
  assert.ok(Math.abs(surges / draws - 7 / 9) < 0.02, `${surges / draws}`);
});

test('a defensive robot holding a surge stops waiting on it: it guards half as much as it otherwise would', () => {
  // Defensive is strike 4 + heavy 1 against guard 4; ready, the guard drops by READY_GUARD_CUT (2),
  // so the surge is 5 in 7. Without it, every other posture cashed its surges in far faster and
  // balanced beat defensive 64% of the time; with it, 61%, as before the surge-or-guard rule.
  assert.equal(READY_GUARD_CUT.defensive, 2);
  let state = hashSeed('ready-defensive');
  let surges = 0;
  const draws = 20000;
  for (let i = 0; i < draws; i++) {
    const chosen = chooseAction(state, ctx({ posture: 'defensive', surgeCharges: 3 }));
    state = chosen.state;
    if (chosen.value === 'surge') surges += 1;
  }
  assert.ok(Math.abs(surges / draws - 5 / 7) < 0.02, `${surges / draws}`);
});
