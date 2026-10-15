import test from 'node:test';
import assert from 'node:assert';
import { narrate } from './narration.js';

const fighters = [
  { name: 'Onerion', clan: 'Onerion', element: 'Fire', sets: { weapon: 'Dominus', torso: 'Shogun', legs: 'Astra', helmet: 'Nova', back: 'Pulse' } },
  { name: 'Zeronex', clan: 'Zeronex', element: 'Ice', sets: { weapon: 'Codex', torso: 'Apex', legs: 'Flux', helmet: 'Vortex', back: 'Nexus' } },
];

test('an action names the attacker', () => {
  const line = narrate({ t: 5000, type: 'action', fighter: 0, action: 'strike' }, fighters);
  assert.ok(line.text.includes('Onerion'));
  assert.equal(line.tone, 'action');
});

test('narration is identical for the same event, so both clients agree', () => {
  const event = { t: 5000, type: 'action', fighter: 0, action: 'strike' };
  assert.deepEqual(narrate(event, fighters), narrate(event, fighters));
});

test('different moments in the battle get different phrasings', () => {
  const lines = new Set();
  for (let t = 0; t < 40; t++) {
    lines.add(narrate({ t: t * 1000, type: 'action', fighter: 0, action: 'strike' }, fighters).text);
  }
  assert.ok(lines.size > 1, 'every strike reads exactly the same');
});

test('equipped set names appear in the prose', () => {
  const texts = [];
  for (let t = 0; t < 40; t++) {
    texts.push(narrate({ t: t * 1000, type: 'action', fighter: 1, action: 'strike' }, fighters).text);
  }
  assert.ok(texts.some((text) => text.includes('Codex') || text.includes('Flux') || text.includes('Apex')));
});

test('damage reads as a number against the victim', () => {
  const line = narrate({ t: 1, type: 'damage', fighter: 1, amount: 83.6, hpAfter: 400, source: 'action' }, fighters);
  assert.ok(line.text.includes('84'), `expected a rounded number, got "${line.text}"`);
});

test('burn damage is narrated as burn, not as a hit', () => {
  const line = narrate({ t: 1, type: 'damage', fighter: 0, amount: 30, hpAfter: 100, source: 'burn' }, fighters);
  assert.equal(line.tone, 'status');
  assert.match(line.text, /burn/i);
});

test('a status application names the effect and the victim', () => {
  const line = narrate({ t: 1, type: 'status', fighter: 1, id: 'freeze', applied: true }, fighters);
  assert.ok(line.text.includes('Zeronex'));
  assert.match(line.text, /froze|frozen|ice/i);
});

test('an expiring status is narrated quietly or not at all', () => {
  const line = narrate({ t: 1, type: 'status', fighter: 1, id: 'freeze', applied: false }, fighters);
  assert.ok(line === null || line.tone === 'status');
});

test('a momentum swing is called out by name', () => {
  const line = narrate({ t: 1, type: 'clashEnd', id: 'tugOfWar', scores: { a: 1, b: 0 }, momentum: { a: 1.1, b: 0.9 } }, fighters);
  assert.equal(line.tone, 'momentum');
  assert.ok(line.text.includes('Onerion'));
});

test('a knockout is final and names the winner', () => {
  const line = narrate({ t: 1, type: 'ko', winner: 0, loser: 1, endReason: 'ko' }, fighters);
  assert.equal(line.tone, 'ko');
  assert.ok(line.text.includes('Onerion'));
});

test('a timeout result reads differently from a knockout', () => {
  const ko = narrate({ t: 1, type: 'ko', winner: 0, loser: 1, endReason: 'ko' }, fighters);
  const timeout = narrate({ t: 1, type: 'ko', winner: 0, loser: 1, endReason: 'timeout' }, fighters);
  assert.notEqual(ko.text, timeout.text);
});

test('sudden death gets a system line', () => {
  const line = narrate({ t: 90_000, type: 'suddenDeath', multiplier: 1.2 }, fighters);
  assert.equal(line.tone, 'system');
});

test('an unknown event type returns null rather than throwing', () => {
  assert.equal(narrate({ t: 1, type: 'telemetry' }, fighters), null);
  assert.equal(narrate(null, fighters), null);
});

test('a missing set name never leaks undefined into the prose', () => {
  const bare = [{ name: 'Bot', clan: null, element: 'Neutral', sets: {} }, fighters[1]];
  for (let t = 0; t < 40; t++) {
    const line = narrate({ t: t * 1000, type: 'action', fighter: 0, action: 'strike' }, bare);
    assert.ok(!line.text.includes('undefined'), line.text);
    assert.ok(!line.text.includes('null'), line.text);
  }
});
