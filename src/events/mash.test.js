import test from 'node:test';
import assert from 'node:assert';
import { emptyMashSide, acceptTaps } from './mash.js';
import { tugOfWar } from './tugOfWar.js';
import { overloadSurge } from './overloadSurge.js';
import { hashSeed } from '../rng.js';
import { MAX_TAPS_PER_SECOND } from '../constants.js';

test('taps accumulate', () => {
  // One-second windows, so 3 then 1 taps are both well inside an honest human rate.
  let side = emptyMashSide();
  side = acceptTaps(side, { taps: 3, seq: 0 }, 1000);
  side = acceptTaps(side, { taps: 1, seq: 1 }, 2000);
  assert.equal(side.taps, 4);
});

test('a window cannot report more taps than a human hand could produce', () => {
  let side = emptyMashSide();
  side = acceptTaps(side, { taps: 500, seq: 0 }, 100);
  assert.equal(side.taps, Math.ceil((100 / 1000) * MAX_TAPS_PER_SECOND));
});

test('no click rate beats the cap, however fast the client claims to be', () => {
  // 40 windows of 100ms = 4 seconds of mashing.
  const run = (rate) => {
    let side = emptyMashSide();
    for (let seq = 0; seq < 40; seq++) {
      side = acceptTaps(side, { taps: Math.round(rate / 10), seq }, (seq + 1) * 100);
    }
    return side.taps;
  };
  const cap = Math.ceil(4 * MAX_TAPS_PER_SECOND);
  assert.ok(run(30) <= cap, `a 30/s autoclicker banked ${run(30)} against a cap of ${cap}`);
  assert.equal(run(30), run(1000), 'clicking faster still gained something');
  assert.equal(run(30), cap, 'the cap should be reachable, just not exceedable');
});

test('an honest human at the cap rate is not short-changed by window rounding', () => {
  let side = emptyMashSide();
  for (let seq = 0; seq < 40; seq++) {
    // A real client posts whole taps: 1 most windows, 2 occasionally, averaging 12/s.
    side = acceptTaps(side, { taps: seq % 5 === 0 ? 2 : 1, seq }, (seq + 1) * 100);
  }
  assert.equal(side.taps, 48, 'an honest 12/s player should bank every tap they made');
});

// Review Focus 4: a retried message must not count twice.
test('a replayed sequence number is ignored', () => {
  let side = emptyMashSide();
  side = acceptTaps(side, { taps: 5, seq: 0 }, 1000);
  const afterFirst = side.taps;
  side = acceptTaps(side, { taps: 5, seq: 0 }, 2000);
  assert.equal(side.taps, afterFirst, 'the retry was counted twice');
});

test('an out-of-order sequence number is ignored', () => {
  let side = emptyMashSide();
  side = acceptTaps(side, { taps: 4, seq: 5 }, 1000);
  const afterFirst = side.taps;
  side = acceptTaps(side, { taps: 4, seq: 2 }, 2000);
  assert.equal(side.taps, afterFirst);
});

test('malformed payloads contribute nothing and do not throw', () => {
  let side = emptyMashSide();
  for (const bad of [null, undefined, {}, { taps: 'many', seq: 1 }, { taps: -5, seq: 2 }, { taps: NaN, seq: 3 }]) {
    side = acceptTaps(side, bad, 1000);
  }
  // A malformed elapsed time is rejected too.
  side = acceptTaps(side, { taps: 3, seq: 9 }, NaN);
  side = acceptTaps(side, { taps: 3, seq: 10 }, -5);
  assert.equal(side.taps, 0);
});

test('tug of war: the side that mashes harder wins and the loser takes a bonus hit', () => {
  let state = tugOfWar.init(hashSeed('tug'), {}).value;
  // The full 5s window at a steady human rate — 50 windows of 100ms.
  for (let seq = 0; seq < 50; seq++) {
    state = tugOfWar.reduce(state, { player: 'a', payload: { taps: 1, seq }, atMs: (seq + 1) * 100 });
  }
  const scored = tugOfWar.score(state);
  assert.ok(scored.a > 0.9);
  assert.ok(scored.b < 0.1);
  assert.deepEqual(scored.bonusHit?.target, 1);
});

test('tug of war: an even struggle is a draw with no bonus hit', () => {
  let state = tugOfWar.init(hashSeed('even'), {}).value;
  for (let seq = 0; seq < 10; seq++) {
    state = tugOfWar.reduce(state, { player: 'a', payload: { taps: 2, seq }, atMs: (seq + 1) * 200 });
    state = tugOfWar.reduce(state, { player: 'b', payload: { taps: 2, seq }, atMs: (seq + 1) * 200 });
  }
  const scored = tugOfWar.score(state);
  assert.equal(scored.a, 0.5);
  assert.equal(scored.b, 0.5);
  assert.equal(scored.bonusHit, undefined);
});

test('tug of war: the bar cannot be pushed past its limit', () => {
  let state = tugOfWar.init(hashSeed('limit'), {}).value;
  for (let seq = 0; seq < 500; seq++) {
    state = tugOfWar.reduce(state, { player: 'a', payload: { taps: 2, seq }, atMs: (seq + 1) * 10 });
  }
  const scored = tugOfWar.score(state);
  assert.ok(scored.a <= 1);
  assert.ok(scored.b >= 0);
});

test('overload surge: filling the gauge scores one, doing nothing scores zero', () => {
  let state = overloadSurge.init(hashSeed('gauge'), {}).value;
  assert.equal(overloadSurge.score(state).a, 0);
  for (let seq = 0; seq < 40; seq++) {
    state = overloadSurge.reduce(state, { player: 'a', payload: { taps: 1, seq }, atMs: (seq + 1) * 100 });
  }
  assert.equal(overloadSurge.score(state).a, 1);
});

test('overload surge: the two players are scored independently', () => {
  let state = overloadSurge.init(hashSeed('independent'), {}).value;
  for (let seq = 0; seq < 10; seq++) {
    state = overloadSurge.reduce(state, { player: 'a', payload: { taps: 1, seq }, atMs: (seq + 1) * 100 });
  }
  const scored = overloadSurge.score(state);
  assert.ok(scored.a > 0);
  assert.equal(scored.b, 0);
});

test('both events are registered and declare the contract', () => {
  for (const event of [tugOfWar, overloadSurge]) {
    assert.equal(typeof event.id, 'string');
    assert.ok(event.durationMs > 0);
    assert.ok(event.momentumShift > 0);
    assert.equal(typeof event.init, 'function');
    assert.equal(typeof event.reduce, 'function');
    assert.equal(typeof event.score, 'function');
  }
});
