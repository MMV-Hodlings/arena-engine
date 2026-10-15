import test from 'node:test';
import assert from 'node:assert';
import { scheduleNextAction, dueFighters } from './timeline.js';
import { hashSeed } from './rng.js';
import { ACTION_CADENCE_MS, ACTION_JITTER } from './constants.js';

test('the next action lands within the jitter band', () => {
  let state = hashSeed('cadence');
  const low = ACTION_CADENCE_MS * (1 - ACTION_JITTER);
  const high = ACTION_CADENCE_MS * (1 + ACTION_JITTER);
  for (let i = 0; i < 500; i++) {
    const next = scheduleNextAction(state, 10_000);
    assert.ok(next.value >= 10_000 + low, `too early: ${next.value}`);
    assert.ok(next.value <= 10_000 + high, `too late: ${next.value}`);
    state = next.state;
  }
});

test('jitter actually varies', () => {
  let state = hashSeed('variety');
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const next = scheduleNextAction(state, 0);
    seen.add(Math.round(next.value));
    state = next.state;
  }
  assert.ok(seen.size > 20, `only ${seen.size} distinct schedules in 50 draws`);
});

test('nobody is due before their gauge fills', () => {
  const fighters = [{ nextActionAt: 4000 }, { nextActionAt: 4200 }];
  assert.deepEqual(dueFighters(fighters, 3999), []);
});

test('a due fighter is returned', () => {
  const fighters = [{ nextActionAt: 4000 }, { nextActionAt: 4200 }];
  assert.deepEqual(dueFighters(fighters, 4000), [0]);
});

test('simultaneous dues are ordered earliest first', () => {
  const fighters = [{ nextActionAt: 4200 }, { nextActionAt: 4100 }];
  assert.deepEqual(dueFighters(fighters, 5000), [1, 0]);
});

test('an exact tie is broken by index, so ordering is deterministic', () => {
  const fighters = [{ nextActionAt: 4000 }, { nextActionAt: 4000 }];
  assert.deepEqual(dueFighters(fighters, 4000), [0, 1]);
});

test('a knocked-out fighter is never due', () => {
  const fighters = [{ nextActionAt: 1000, hp: 0 }, { nextActionAt: 1000, hp: 50 }];
  assert.deepEqual(dueFighters(fighters, 2000), [1]);
});
