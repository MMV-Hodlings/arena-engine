import test from 'node:test';
import assert from 'node:assert';
import { clampMomentum, shiftMomentum, applyClashScores } from './momentum.js';
import { MOMENTUM_MIN, MOMENTUM_MAX, MOMENTUM_SHIFT, MOMENTUM_SHIFT_READ } from './constants.js';

test('momentum is clamped to the agreed band', () => {
  assert.equal(clampMomentum(5), MOMENTUM_MAX);
  assert.equal(clampMomentum(0), MOMENTUM_MIN);
  assert.equal(clampMomentum(1), 1);
});

test('a perfect score shifts momentum up by the full step', () => {
  assert.ok(Math.abs(shiftMomentum(1, 1, MOMENTUM_SHIFT) - 1.1) < 1e-9);
});

test('a zero score shifts momentum down by the full step', () => {
  assert.ok(Math.abs(shiftMomentum(1, 0, MOMENTUM_SHIFT) - 0.9) < 1e-9);
});

test('an average score leaves momentum untouched', () => {
  assert.ok(Math.abs(shiftMomentum(1.05, 0.5, MOMENTUM_SHIFT) - 1.05) < 1e-9);
});

test('momentum cannot be pushed past the clamp however many events are won', () => {
  let m = 1;
  for (let i = 0; i < 50; i++) m = shiftMomentum(m, 1, MOMENTUM_SHIFT);
  assert.equal(m, MOMENTUM_MAX);
  for (let i = 0; i < 50; i++) m = shiftMomentum(m, 0, MOMENTUM_SHIFT);
  assert.equal(m, MOMENTUM_MIN);
});

test('the Read event uses the smaller shift', () => {
  assert.ok(Math.abs(shiftMomentum(1, 1, MOMENTUM_SHIFT_READ) - 1.05) < 1e-9);
});

test('a clash event moves both players independently', () => {
  const next = applyClashScores({ a: 1, b: 1 }, { a: 1, b: 0.25 }, MOMENTUM_SHIFT);
  assert.ok(Math.abs(next.a - 1.1) < 1e-9);
  assert.ok(Math.abs(next.b - 0.95) < 1e-9);
});

test('the achievable damage swing from momentum alone is exactly the agreed cap', () => {
  // The spec caps skill influence at +/-20%: best momentum over worst is 1.2/0.8 = 1.5.
  assert.ok(Math.abs(MOMENTUM_MAX / MOMENTUM_MIN - 1.5) < 1e-9);
  assert.ok(Math.abs(MOMENTUM_MAX - 1 - 0.2) < 1e-9);
  assert.ok(Math.abs(1 - MOMENTUM_MIN - 0.2) < 1e-9);
});
