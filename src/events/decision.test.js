import test from 'node:test';
import assert from 'node:assert';
import { CLASH_EVENTS } from './index.js';
import { read } from './read.js';
import { powerRouting } from './powerRouting.js';
import { BRIEFING_MS, DECISION_WINDOW_MS } from '../constants.js';

test('the Read and Power Routing give fifteen seconds and no briefing', () => {
  assert.equal(DECISION_WINDOW_MS, 15_000);
  for (const event of [read, powerRouting]) {
    assert.equal(event.durationMs, 15_000);
    assert.ok(!event.briefingMs);
  }
});

test('the timing events keep their windows and are briefed for two seconds', () => {
  assert.equal(BRIEFING_MS, 2000);
  const windows = { reflexStrike: 3000, targetingLock: 4000, sequenceLock: 5000, tugOfWar: 5000, overloadSurge: 4000 };
  for (const [id, ms] of Object.entries(windows)) {
    assert.equal(CLASH_EVENTS[id].durationMs, ms, id);
    assert.equal(CLASH_EVENTS[id].briefingMs, BRIEFING_MS, id);
  }
});

test('a Read is settled only once both robots have a stance', () => {
  let s = read.init(0, { heavyBy: 0 }).value;
  assert.equal(read.settled(s), false);
  s = read.reduce(s, { player: 'a', payload: { stance: 'strike' } });
  assert.equal(read.settled(s), false);
  s = read.reduce(s, { player: 'b', payload: { stance: 'guard' } });
  assert.equal(read.settled(s), true);
});

test('Power Routing is settled only once both have committed', () => {
  let s = powerRouting.init(0).value;
  s = powerRouting.reduce(s, { player: 'b', payload: { pips: { atk: 3, def: 0, surge: 0 } } });
  assert.equal(powerRouting.settled(s), false);
  s = powerRouting.reduce(s, { player: 'a', payload: { pips: { atk: 1, def: 1, surge: 1 } } });
  assert.equal(powerRouting.settled(s), true);
});

test('the Read still publishes nothing but who is winding up', () => {
  let s = read.init(0, { heavyBy: 1 }).value;
  s = read.reduce(s, { player: 'a', payload: { stance: 'overload' } });
  assert.deepEqual(read.publicState(s), { heavyBy: 1 });
});
