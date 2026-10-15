import test from 'node:test';
import assert from 'node:assert';
import { reflexStrike } from './reflexStrike.js';
import { targetingLock } from './targetingLock.js';
import { sequenceLock } from './sequenceLock.js';
import { powerRouting } from './powerRouting.js';
import { hashSeed } from '../rng.js';

test('reflex strike: hitting the sweet spot exactly scores one', () => {
  const state = reflexStrike.init(hashSeed('reflex'), {}).value;
  const pressed = reflexStrike.reduce(state, { player: 'a', payload: {}, atMs: state.sweetSpotMs });
  assert.equal(reflexStrike.score(pressed).a, 1);
});

test('reflex strike: not pressing scores zero', () => {
  const state = reflexStrike.init(hashSeed('reflex'), {}).value;
  assert.equal(reflexStrike.score(state).a, 0);
});

test('reflex strike: the score falls off with distance and bottoms out at zero', () => {
  const state = reflexStrike.init(hashSeed('falloff'), {}).value;
  const near = reflexStrike.reduce(state, { player: 'a', payload: {}, atMs: state.sweetSpotMs + state.toleranceMs / 2 });
  const far = reflexStrike.reduce(state, { player: 'a', payload: {}, atMs: state.sweetSpotMs + state.toleranceMs * 5 });
  assert.ok(Math.abs(reflexStrike.score(near).a - 0.5) < 1e-9);
  assert.equal(reflexStrike.score(far).a, 0);
});

test('reflex strike: only the first press counts', () => {
  const state = reflexStrike.init(hashSeed('first'), {}).value;
  let pressed = reflexStrike.reduce(state, { player: 'a', payload: {}, atMs: state.sweetSpotMs * 10 });
  pressed = reflexStrike.reduce(pressed, { player: 'a', payload: {}, atMs: state.sweetSpotMs });
  assert.ok(reflexStrike.score(pressed).a < 1);
});

test('reflex strike: the sweet spot varies with the seed but stays inside the window', () => {
  const spots = new Set();
  for (let i = 0; i < 25; i++) {
    const state = reflexStrike.init(hashSeed(`spot-${i}`), {}).value;
    assert.ok(state.sweetSpotMs > 0 && state.sweetSpotMs < reflexStrike.durationMs);
    spots.add(Math.round(state.sweetSpotMs));
  }
  assert.ok(spots.size > 10, 'the sweet spot barely moves between seeds');
});

test('targeting lock: stopping on the weak point scores one', () => {
  const state = targetingLock.init(hashSeed('target'), {}).value;
  const perfectMs = targetingLock.timeAtPosition(state, state.weakPoint);
  const stopped = targetingLock.reduce(state, { player: 'a', payload: {}, atMs: perfectMs });
  assert.ok(targetingLock.score(stopped).a > 0.99);
});

test('targeting lock: never stopping scores zero', () => {
  const state = targetingLock.init(hashSeed('target'), {}).value;
  assert.equal(targetingLock.score(state).a, 0);
});

test('targeting lock: the crosshair position is a pure function of time', () => {
  const state = targetingLock.init(hashSeed('pure'), {}).value;
  assert.equal(targetingLock.positionAt(state, 1234), targetingLock.positionAt(state, 1234));
});

test('sequence lock: the whole sequence in order scores highly', () => {
  const state = sequenceLock.init(hashSeed('sequence'), {}).value;
  const done = sequenceLock.reduce(state, { player: 'a', payload: { keys: state.sequence }, atMs: 500 });
  assert.ok(sequenceLock.score(done).a > 0.9);
});

test('sequence lock: a wrong key stops the run short', () => {
  const state = sequenceLock.init(hashSeed('wrong'), {}).value;
  const wrong = state.sequence[0] === 'up' ? 'down' : 'up';
  const done = sequenceLock.reduce(state, { player: 'a', payload: { keys: [state.sequence[0], wrong, state.sequence[2]] }, atMs: 500 });
  const scored = sequenceLock.score(done).a;
  assert.ok(scored > 0 && scored < 0.5, `partial credit expected, got ${scored}`);
});

test('sequence lock: being slow scores less than being fast', () => {
  const state = sequenceLock.init(hashSeed('speed'), {}).value;
  const fast = sequenceLock.reduce(state, { player: 'a', payload: { keys: state.sequence }, atMs: 200 });
  const slow = sequenceLock.reduce(state, { player: 'a', payload: { keys: state.sequence }, atMs: sequenceLock.durationMs - 1 });
  assert.ok(sequenceLock.score(fast).a > sequenceLock.score(slow).a);
});

test('sequence lock: doing nothing scores zero', () => {
  const state = sequenceLock.init(hashSeed('nothing'), {}).value;
  assert.equal(sequenceLock.score(state).a, 0);
});

test('power routing: both sides score neutrally, so it never moves momentum', () => {
  const state = powerRouting.init(hashSeed('pips'), {}).value;
  const scored = powerRouting.score(state);
  assert.equal(scored.a, 0.5);
  assert.equal(scored.b, 0.5);
});

test('power routing: pips become buffs', () => {
  let state = powerRouting.init(hashSeed('pips'), {}).value;
  state = powerRouting.reduce(state, { player: 'a', payload: { pips: { atk: 2, def: 1, surge: 0 } }, atMs: 100 });
  const buffs = powerRouting.score(state).buffs;
  assert.ok(Math.abs(buffs.a.atkMult - 1.3) < 1e-9);
  assert.ok(Math.abs(buffs.a.defMult - 1.15) < 1e-9);
});

test('power routing: more than three pips is rejected outright', () => {
  let state = powerRouting.init(hashSeed('cheat'), {}).value;
  state = powerRouting.reduce(state, { player: 'a', payload: { pips: { atk: 99, def: 99, surge: 99 } }, atMs: 100 });
  const buffs = powerRouting.score(state).buffs;
  assert.equal(buffs.a.atkMult, undefined);
  assert.equal(buffs.a.surge, undefined);
});

test('power routing: negative pips are rejected', () => {
  let state = powerRouting.init(hashSeed('negative'), {}).value;
  state = powerRouting.reduce(state, { player: 'a', payload: { pips: { atk: 5, def: -5, surge: 3 } }, atMs: 100 });
  assert.equal(powerRouting.score(state).buffs.a.atkMult, undefined);
});

test('power routing: surge pips are granted as charges', () => {
  let state = powerRouting.init(hashSeed('charges'), {}).value;
  state = powerRouting.reduce(state, { player: 'b', payload: { pips: { atk: 0, def: 0, surge: 3 } }, atMs: 100 });
  assert.equal(powerRouting.score(state).buffs.b.surge, 3);
});
