import test from 'node:test';
import assert from 'node:assert';
import { normalizeElement, elementMultiplier, statusForElement, NEUTRAL } from './elements.js';

test('advantaged elements get 1.10', () => {
  assert.equal(elementMultiplier('Earth', 'Lightning'), 1.1);
  assert.equal(elementMultiplier('Lightning', 'Air'), 1.1);
  assert.equal(elementMultiplier('Air', 'Earth'), 1.1);
  assert.equal(elementMultiplier('Fire', 'Ice'), 1.1);
  assert.equal(elementMultiplier('Ice', 'Water'), 1.1);
  assert.equal(elementMultiplier('Water', 'Fire'), 1.1);
});

test('the disadvantaged side gets no penalty, only the absence of a bonus', () => {
  assert.equal(elementMultiplier('Lightning', 'Earth'), 1);
  assert.equal(elementMultiplier('Ice', 'Fire'), 1);
});

test('any element against Neutral gets 1.05', () => {
  assert.equal(elementMultiplier('Fire', 'Neutral'), 1.05);
  assert.equal(elementMultiplier('Earth', NEUTRAL), 1.05);
});

test('Neutral attacking anything gets no bonus', () => {
  assert.equal(elementMultiplier('Neutral', 'Fire'), 1);
  assert.equal(elementMultiplier('Neutral', 'Neutral'), 1);
});

test('elements from different cycles do not interact', () => {
  assert.equal(elementMultiplier('Fire', 'Air'), 1);
  assert.equal(elementMultiplier('Earth', 'Water'), 1);
});

// Review Focus 2: malformed element values must degrade to Neutral, never throw,
// and never hand out an advantage by accident.
test('malformed element values degrade to Neutral', () => {
  for (const bad of ['neutral', 'NEUTRAL', '', '   ', null, undefined, 0, 'Shadow', {}]) {
    assert.equal(normalizeElement(bad), NEUTRAL, `failed for ${JSON.stringify(bad)}`);
  }
});

test('lowercase element names are accepted and canonicalised', () => {
  assert.equal(normalizeElement('fire'), 'Fire');
  assert.equal(normalizeElement('  ICE  '), 'Ice');
  assert.equal(elementMultiplier('fire', 'ice'), 1.1);
});

test('a malformed element never produces a bonus', () => {
  assert.equal(elementMultiplier('Shadow', 'Fire'), 1);
  assert.equal(elementMultiplier(null, undefined), 1);
  assert.equal(elementMultiplier('Fire', 'Shadow'), 1.05); // Shadow reads as Neutral
});

test('each element maps to its status effect', () => {
  assert.deepEqual(statusForElement('Fire'), { id: 'burn', actions: 3 });
  assert.deepEqual(statusForElement('Ice'), { id: 'freeze', actions: 1 });
  assert.deepEqual(statusForElement('Lightning'), { id: 'shock', actions: 2 });
  // Gust guards the surging robot itself, and outlasts the tick at the end of the surge.
  assert.deepEqual(statusForElement('Air'), { id: 'gust', actions: 2, self: true });
  assert.deepEqual(statusForElement('Earth'), { id: 'quake', actions: 1 });
  assert.deepEqual(statusForElement('Water'), { id: 'drench', actions: 2 });
  assert.equal(statusForElement('Neutral'), null);
  assert.equal(statusForElement('Shadow'), null);
});
