/**
 * What a client is allowed to see while a clash event is open.
 *
 * A live playtest found the timing events unplayable: Reflex Strike and Targeting Lock
 * rendered as a bare button because their parameters never left the server, so the player
 * could only guess. Publishing the sweet spot is the fix and is intended — reading the
 * ring is the game, and landing on it is the skill. What may never be published is
 * anything that lets a client score without playing.
 */

import test from 'node:test';
import assert from 'node:assert';
import { CLASH_EVENTS } from './index.js';
import { hashSeed } from '../rng.js';

test('every event publishes something for the client to draw', () => {
  for (const [id, event] of Object.entries(CLASH_EVENTS)) {
    assert.equal(typeof event.publicState, 'function', `${id} has no publicState`);
    const state = event.init(hashSeed(id), { heavyBy: 0 }).value;
    const published = event.publicState(state);
    assert.ok(published && typeof published === 'object', `${id} published nothing`);
  }
});

test('reflex strike publishes where the sweet spot is, because reading it is the game', () => {
  const state = CLASH_EVENTS.reflexStrike.init(hashSeed('r'), {}).value;
  const published = CLASH_EVENTS.reflexStrike.publicState(state);
  assert.equal(published.sweetSpotMs, state.sweetSpotMs);
  assert.equal(published.toleranceMs, state.toleranceMs);
});

test('targeting lock publishes the drift so the crosshair can be drawn', () => {
  const state = CLASH_EVENTS.targetingLock.init(hashSeed('t'), {}).value;
  const published = CLASH_EVENTS.targetingLock.publicState(state);
  assert.equal(published.periodMs, state.periodMs);
  assert.equal(published.phase, state.phase);
  assert.equal(published.weakPoint, state.weakPoint);
});

test('sequence lock publishes the sequence to repeat', () => {
  const state = CLASH_EVENTS.sequenceLock.init(hashSeed('s'), {}).value;
  assert.deepEqual(CLASH_EVENTS.sequenceLock.publicState(state).sequence, state.sequence);
});

test('tug of war publishes the bar position, not the raw tap counts', () => {
  const event = CLASH_EVENTS.tugOfWar;
  let state = event.init(hashSeed('tug'), {}).value;
  for (let seq = 0; seq < 10; seq++) {
    state = event.reduce(state, { player: 'a', payload: { taps: 1, seq }, atMs: (seq + 1) * 100 });
  }
  const published = event.publicState(state);
  assert.ok(typeof published.position === 'number');
  assert.ok(published.position > 0 && published.position <= 1);
});

test('overload surge publishes how full each gauge is', () => {
  const event = CLASH_EVENTS.overloadSurge;
  let state = event.init(hashSeed('o'), {}).value;
  state = event.reduce(state, { player: 'a', payload: { taps: 6, seq: 0 }, atMs: 1000 });
  const published = event.publicState(state);
  assert.ok(published.fill.a > 0 && published.fill.a <= 1);
  assert.equal(published.fill.b, 0);
});

test('power routing publishes the pip budget', () => {
  const state = CLASH_EVENTS.powerRouting.init(hashSeed('p'), {}).value;
  assert.equal(CLASH_EVENTS.powerRouting.publicState(state).pips, 3);
});

// Review Focus 5: visible, not solved.
test('no event publishes an opponent commitment before the window closes', () => {
  const read = CLASH_EVENTS.read;
  let state = read.init(hashSeed('read'), { heavyBy: 0 }).value;
  state = read.reduce(state, { player: 'b', payload: { stance: 'overload' }, atMs: 100 });
  const published = JSON.stringify(read.publicState(state));
  assert.equal(
    published.includes('overload'),
    false,
    'the opponent stance leaked, so a client could always counter it',
  );
});

// An earlier test here asserted that the Read published each side's committed flag. That
// was the exploit, written down as a requirement — removed rather than relaxed.
test('published state carries no raw per-seat internals', () => {
  // Checked after input, not on fresh state, and at any depth — the shallow version of
  // this test let overloadSurge's nested fill:{a,b} sail straight past it.
  const sawTapCounts = (value) =>
    JSON.stringify(value ?? {}).includes('"taps"') || JSON.stringify(value ?? {}).includes('"lastSeq"');

  for (const [id, event] of Object.entries(CLASH_EVENTS)) {
    let state = event.init(hashSeed(id), { heavyBy: 0 }).value;
    state = event.reduce(state, { player: 'a', payload: { taps: 3, seq: 0, stance: 'guard' }, atMs: 100 });
    const published = event.publicState(state);
    assert.equal(sawTapCounts(published), false, `${id} published raw tap bookkeeping`);
    assert.equal(
      Object.hasOwn(published, 'presses') || Object.hasOwn(published, 'picks') || Object.hasOwn(published, 'entries'),
      false,
      `${id} published its internal structures verbatim`,
    );
  }
});

test('publishing never mutates the event state', () => {
  for (const [id, event] of Object.entries(CLASH_EVENTS)) {
    const state = event.init(hashSeed(id), { heavyBy: 0 }).value;
    const before = JSON.stringify(state);
    event.publicState(state);
    assert.equal(JSON.stringify(state), before, `${id} mutated its state while publishing`);
  }
});

// A review found the real leak: publishing WHETHER each side has committed lets a client
// poll at tick resolution, wait for the opponent to commit or time out, and always move
// last. Stance reads sit outside SKILL_INFLUENCE_CAP, so that edge is unbounded — the one
// place in the design where that is true.
test('nothing about commitment is published while the window is open', () => {
  const read = CLASH_EVENTS.read;
  let state = read.init(hashSeed('leak'), { heavyBy: 0 }).value;

  const empty = JSON.stringify(read.publicState(state));
  state = read.reduce(state, { player: 'b', payload: { stance: 'overload' }, atMs: 100 });
  const afterOpponentCommitted = JSON.stringify(read.publicState(state));

  assert.equal(
    afterOpponentCommitted,
    empty,
    'the published state changed when the opponent committed, so a client can wait them out',
  );
});

test('the read still says who is winding up, which is what the client draws', () => {
  const state = CLASH_EVENTS.read.init(hashSeed('telegraph'), { heavyBy: 1 }).value;
  assert.equal(CLASH_EVENTS.read.publicState(state).heavyBy, 1);
});

test('no event reveals that an opponent has acted', () => {
  // Every event: committing must not change what the other side can observe.
  const commitments = {
    read: { stance: 'guard' },
    reflexStrike: {},
    targetingLock: {},
    sequenceLock: { keys: ['up', 'up', 'up', 'up', 'up'] },
    powerRouting: { pips: { atk: 3, def: 0, surge: 0 } },
  };
  for (const [id, payload] of Object.entries(commitments)) {
    const event = CLASH_EVENTS[id];
    let state = event.init(hashSeed(`reveal-${id}`), { heavyBy: 0 }).value;
    const before = JSON.stringify(event.publicState(state));
    state = event.reduce(state, { player: 'b', payload, atMs: 200 });
    assert.equal(
      JSON.stringify(event.publicState(state)),
      before,
      `${id} told the other player that b had acted`,
    );
  }
});
