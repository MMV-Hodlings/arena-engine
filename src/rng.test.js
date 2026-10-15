import test from 'node:test';
import assert from 'node:assert';
import { hashSeed, nextRandom, randomRange, randomInt, weightedPick } from './rng.js';

test('hashSeed is stable for the same string', () => {
  assert.equal(hashSeed('battle-42'), hashSeed('battle-42'));
});

test('hashSeed differs for different strings', () => {
  assert.notEqual(hashSeed('battle-42'), hashSeed('battle-43'));
});

test('nextRandom returns values in [0, 1)', () => {
  let state = hashSeed('seed');
  for (let i = 0; i < 1000; i++) {
    const r = nextRandom(state);
    assert.ok(r.value >= 0 && r.value < 1, `value out of range: ${r.value}`);
    state = r.state;
  }
});

test('the same seed produces the same sequence', () => {
  const run = () => {
    let state = hashSeed('same');
    const out = [];
    for (let i = 0; i < 20; i++) {
      const r = nextRandom(state);
      out.push(r.value);
      state = r.state;
    }
    return out;
  };
  assert.deepEqual(run(), run());
});

test('different seeds produce different sequences', () => {
  const first = nextRandom(hashSeed('a')).value;
  const second = nextRandom(hashSeed('b')).value;
  assert.notEqual(first, second);
});

test('randomRange stays within bounds', () => {
  let state = hashSeed('range');
  for (let i = 0; i < 500; i++) {
    const r = randomRange(state, 3400, 4600);
    assert.ok(r.value >= 3400 && r.value < 4600);
    state = r.state;
  }
});

test('randomInt returns integers below the exclusive max', () => {
  let state = hashSeed('int');
  for (let i = 0; i < 500; i++) {
    const r = randomInt(state, 6);
    assert.ok(Number.isInteger(r.value));
    assert.ok(r.value >= 0 && r.value < 6);
    state = r.state;
  }
});

test('weightedPick never returns a zero-weight entry', () => {
  let state = hashSeed('weights');
  for (let i = 0; i < 500; i++) {
    const r = weightedPick(state, [['never', 0], ['always', 5]]);
    assert.equal(r.value, 'always');
    state = r.state;
  }
});

test('weightedPick respects relative weights', () => {
  let state = hashSeed('distribution');
  let heavy = 0;
  for (let i = 0; i < 2000; i++) {
    const r = weightedPick(state, [['heavy', 9], ['light', 1]]);
    if (r.value === 'heavy') heavy++;
    state = r.state;
  }
  assert.ok(heavy > 1700 && heavy < 1960, `heavy picked ${heavy}/2000`);
});
