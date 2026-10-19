import test from 'node:test';
import assert from 'node:assert';
import { hitMoments } from './moments.js';

const side = (hp, maxHp = 1000, streak = 1) => ({ hp, maxHp, streak });

test('first blood is the first damage of the battle', () => {
  assert.deepEqual(hitMoments({ target: side(1000), attacker: side(1000), dealt: 80, firstBlood: true }), ['firstBlood']);
});

test('a hit that takes the target below half, or a quarter, says so', () => {
  assert.deepEqual(hitMoments({ target: side(520), attacker: side(900), dealt: 40, firstBlood: false }), ['half']);
  assert.deepEqual(hitMoments({ target: side(260), attacker: side(900), dealt: 20, firstBlood: false }), ['quarter']);
  assert.deepEqual(hitMoments({ target: side(520), attacker: side(900), dealt: 300, firstBlood: false }), ['half', 'quarter']);
});

test('a streak is the third damaging hit in a row, once', () => {
  assert.ok(hitMoments({ target: side(900), attacker: side(900, 1000, 3), dealt: 50, firstBlood: false }).includes('streak'));
  assert.ok(!hitMoments({ target: side(900), attacker: side(900, 1000, 4), dealt: 50, firstBlood: false }).includes('streak'));
});

test('a comeback is a crushing hit from at least thirty points behind', () => {
  assert.ok(hitMoments({ target: side(800), attacker: side(400), dealt: 150, firstBlood: false }).includes('comeback'));
  assert.ok(!hitMoments({ target: side(800), attacker: side(400), dealt: 100, firstBlood: false }).includes('comeback'));
  assert.ok(!hitMoments({ target: side(800), attacker: side(550), dealt: 150, firstBlood: false }).includes('comeback'));
});

test('a hit that deals nothing has no moments', () => {
  assert.deepEqual(hitMoments({ target: side(520), attacker: side(900, 1000, 3), dealt: 0, firstBlood: true }), []);
});
