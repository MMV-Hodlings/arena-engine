import test from 'node:test';
import assert from 'node:assert';
import {
  applyElementStatus, hasStatus, consumeStatus, tickStatuses, effectiveDefense, burnDamage,
} from './status.js';

test('applying an element status records it with its duration', () => {
  const { statuses, applied } = applyElementStatus([], 'Fire');
  assert.deepEqual(applied, { id: 'burn', actions: 3 });
  assert.deepEqual(statuses, [{ id: 'burn', remaining: 3 }]);
});

test('a Neutral robot applies nothing', () => {
  const { statuses, applied } = applyElementStatus([], 'Neutral');
  assert.equal(applied, null);
  assert.deepEqual(statuses, []);
});

test('reapplying a status refreshes its duration instead of stacking', () => {
  let { statuses } = applyElementStatus([], 'Lightning');
  statuses = tickStatuses(statuses);
  assert.deepEqual(statuses, [{ id: 'shock', remaining: 1 }]);
  ({ statuses } = applyElementStatus(statuses, 'Lightning'));
  assert.deepEqual(statuses, [{ id: 'shock', remaining: 2 }]);
});

test('ticking decrements and expires', () => {
  let { statuses } = applyElementStatus([], 'Ice'); // freeze, 1 action
  assert.ok(hasStatus(statuses, 'freeze'));
  statuses = tickStatuses(statuses);
  assert.equal(hasStatus(statuses, 'freeze'), false);
  assert.deepEqual(statuses, []);
});

test('consuming removes a one-shot status immediately', () => {
  const { statuses } = applyElementStatus([], 'Air'); // gust
  assert.ok(hasStatus(statuses, 'gust'));
  assert.deepEqual(consumeStatus(statuses, 'gust'), []);
});

test('consuming a status that is not present is a no-op', () => {
  assert.deepEqual(consumeStatus([{ id: 'burn', remaining: 2 }], 'gust'), [{ id: 'burn', remaining: 2 }]);
});

test('shock cuts defence by a quarter', () => {
  const { statuses } = applyElementStatus([], 'Lightning');
  assert.ok(Math.abs(effectiveDefense(statuses, 1000) - 750) < 1e-9);
  assert.equal(effectiveDefense([], 1000), 1000);
});

test('burn costs four percent of max HP per action while it lasts', () => {
  const { statuses } = applyElementStatus([], 'Fire');
  assert.ok(Math.abs(burnDamage(statuses, 1000) - 40) < 1e-9);
  assert.equal(burnDamage([], 1000), 0);
});

test('several statuses coexist and tick independently', () => {
  let { statuses } = applyElementStatus([], 'Fire'); // burn 3
  ({ statuses } = applyElementStatus(statuses, 'Lightning')); // shock 2
  statuses = tickStatuses(statuses);
  statuses = tickStatuses(statuses);
  assert.ok(hasStatus(statuses, 'burn'));
  assert.equal(hasStatus(statuses, 'shock'), false);
});

test('the input array is never mutated', () => {
  const original = [{ id: 'burn', remaining: 2 }];
  tickStatuses(original);
  consumeStatus(original, 'burn');
  applyElementStatus(original, 'Ice');
  assert.deepEqual(original, [{ id: 'burn', remaining: 2 }]);
});
