import test from 'node:test';
import assert from 'node:assert';
import { narrate } from './narration.js';
import { LINES } from './narration-lines.js';

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

test('a set name that just repeats the robot name is dropped', () => {
  // A full-sync robot is named after its set, so "Dominus finds the gap in Dominus AI's
  // Dominus plating" is what naive interpolation produces. The part keeps its noun and
  // loses the redundant adjective.
  const sameName = [
    { name: 'Dominus', clan: 'Onerion', element: 'Ice', sets: { weapon: 'Dominus', torso: 'Dominus', legs: 'Dominus', helmet: 'Dominus', back: 'Dominus' } },
    { name: 'Dominus AI', clan: 'Onerion', element: 'Ice', sets: { weapon: 'Dominus', torso: 'Dominus', legs: 'Dominus', helmet: 'Dominus', back: 'Dominus' } },
  ];
  for (let t = 0; t < 40; t++) {
    const line = narrate({ t: t * 1000, type: 'action', fighter: 0, action: 'strike' }, sameName);
    const hits = line.text.split('Dominus').length - 1;
    assert.ok(hits <= 2, `"${line.text}" says the name ${hits} times`);
  }
});

test('a distinctive set name is still used', () => {
  const mixed = [
    { name: 'Shogun', clan: 'Onerion', element: 'Fire', sets: { weapon: 'Astra', torso: 'Nova', legs: 'Flux', helmet: 'Pulse', back: 'Vortex' } },
    { name: 'Apex AI', clan: 'Zeronex', element: 'Ice', sets: { weapon: 'Codex', torso: 'Apex', legs: 'Flux', helmet: 'Vortex', back: 'Nexus' } },
  ];
  const texts = [];
  for (let t = 0; t < 40; t++) {
    texts.push(narrate({ t: t * 1000, type: 'action', fighter: 0, action: 'strike' }, mixed).text);
  }
  assert.ok(
    texts.some((text) => /Astra|Nova|Flux|Pulse/.test(text)),
    'set names vanished even when they were distinctive',
  );
});

// ── The battle pacing design: one line per blow, big moments, richer sets ──

const sized = fighters.map((f) => ({ ...f, maxHp: 1000, hp: 1000 }));
const IDS = ['read', 'reflexStrike', 'targetingLock', 'tugOfWar', 'overloadSurge', 'sequenceLock', 'powerRouting'];
const STANCES = ['strike', 'guard', 'overload'];
const strike = (over = {}) => ({ t: 5000, type: 'action', fighter: 0, action: 'strike', amount: 100, moments: [], ...over });

test('a blow is one line with its damage in it, and its damage event says nothing', () => {
  const line = narrate(strike({ amount: 84.4 }), sized);
  assert.match(line.text, /\b84\b/);
  for (const source of ['action', 'exchange']) {
    assert.equal(narrate({ t: 5000, type: 'damage', fighter: 1, amount: 84, hpAfter: 916, source }, sized), null, source);
  }
  for (const source of ['burn', 'clash']) {
    assert.ok(narrate({ t: 5000, type: 'damage', fighter: 1, amount: 30, hpAfter: 900, source }, sized), source);
  }
});

test('the size of a hit picks its wording', () => {
  const texts = (amount) => new Set(
    Array.from({ length: 40 }, (_, i) => narrate(strike({ t: i * 1000, amount }), sized).text.replace(/\d+/g, '#')),
  );
  const graze = texts(30);
  const solid = texts(100);
  const crushing = texts(200);
  for (const text of graze) assert.ok(!solid.has(text) && !crushing.has(text), text);
  for (const text of solid) assert.ok(!crushing.has(text), text);
  assert.equal(narrate(strike({ amount: 200 }), sized).tone, 'crit');
  assert.equal(narrate(strike({ amount: 100 }), sized).tone, 'action');
});

test('a moment replaces the plain line, in the order comeback, quarter, streak, half, first blood', () => {
  const order = ['comeback', 'quarter', 'streak', 'half', 'firstBlood'];
  for (let i = 0; i < order.length; i++) {
    const line = narrate(strike({ t: 7000 + i, amount: 160, moments: order.slice(i).reverse() }), sized);
    const sentences = LINES.moment[order[i]].map((template) => template(sized[0], sized[1]));
    assert.ok(sentences.some((sentence) => line.text.startsWith(sentence)), `${order[i]}: ${line.text}`);
  }
});

test('every set is as large as the design asks', () => {
  for (const tier of ['graze', 'solid', 'crushing']) assert.ok(LINES.blow[tier].length >= 8, tier);
  for (const key of ['firstBlood', 'half', 'quarter', 'streak', 'comeback']) assert.ok(LINES.moment[key].length >= 3, key);
  assert.ok(LINES.guard.length >= 6, 'guard');
  for (const element of ['Air', 'Earth', 'Fire', 'Ice', 'Lightning', 'Water']) assert.ok(LINES.surge[element].length >= 3, element);
  for (const id of ['burn', 'freeze', 'shock', 'gust', 'quake', 'drench']) assert.ok(LINES.status[id].length >= 3, id);
  for (const stance of STANCES) assert.ok(LINES.heavy[stance].length >= 3, stance);
  for (const a of STANCES) for (const b of STANCES) assert.ok(LINES.read[`${a}-${b}`].length >= 2, `${a}-${b}`);
  for (const id of IDS) {
    assert.ok(LINES.omen[id].length >= 4, `omen ${id}`);
    assert.ok(LINES.clash[id].won.length >= 2 && LINES.clash[id].even.length >= 2, `clash ${id}`);
  }
  for (const margin of ['rout', 'clear', 'close']) assert.ok(LINES.ko[margin].length >= 3, margin);
});

test('a hint never names its event', () => {
  const forbidden = {
    read: /\bread\b/i, reflexStrike: /reflex/i, targetingLock: /targeting lock/i, tugOfWar: /tug of war/i,
    overloadSurge: /overload surge/i, sequenceLock: /sequence lock/i, powerRouting: /power routing/i,
  };
  for (const id of IDS) {
    for (const template of LINES.omen[id]) {
      const text = template(sized[0], sized[1]);
      assert.ok(!forbidden[id].test(text), `${id}: "${text}"`);
    }
  }
});

test('an omen is a hint line in its own tone', () => {
  const line = narrate({ t: 5000, type: 'omen', id: 'reflexStrike', fighter: 0 }, sized);
  assert.equal(line.tone, 'omen');
  assert.ok(line.text.includes('Onerion'), line.text);
});

test('an event opening says nothing; its hint already did', () => {
  assert.equal(narrate({ t: 1, type: 'clashStart', id: 'read', public: { heavyBy: 0 } }, sized), null);
});

test("a clash result is told in its event's own terms", () => {
  for (const id of IDS) {
    const won = narrate({ t: 1, type: 'clashEnd', id, scores: { a: 0.9, b: 0.1 }, momentum: { a: 1.1, b: 0.9 } }, sized);
    assert.equal(won.tone, 'momentum');
    assert.ok(won.text.includes('Onerion'), `${id}: ${won.text}`);
    const even = narrate({ t: 1, type: 'clashEnd', id, scores: { a: 0.5, b: 0.5 }, momentum: { a: 1, b: 1 } }, sized);
    assert.ok(LINES.clash[id].even.map((template) => template(sized[0], sized[1])).includes(even.text), `${id}: ${even.text}`);
    for (const template of [...LINES.clash[id].won, ...LINES.clash[id].even]) {
      assert.ok(!/seizes the momentum/i.test(template(sized[0], sized[1])), id);
    }
  }
});

test('a heavy swing and a Read are told as a contest, never by stance names', () => {
  const hits = [{ fighter: 1, amount: 52.2, moments: [] }, { fighter: 0, amount: 31.4, moments: [] }];
  for (const a of STANCES) {
    for (const b of STANCES) {
      for (const source of ['heavy', 'read']) {
        if (source === 'heavy' && a !== 'overload') continue;
        for (let t = 0; t < 6; t++) {
          const line = narrate({ t, type: 'exchange', source, by: 0, stances: { a, b }, outcome: 'tie', hits }, sized);
          assert.ok(!/\b(strike|guard|overload) against (strike|guard|overload)\b/i.test(line.text), line.text);
          if (source === 'heavy') {
            assert.match(line.text, /\b52\b/);
            assert.match(line.text, /\b31\b/);
          }
        }
      }
    }
  }
});

test('an ending reads by its margin', () => {
  const at = (hp) => sized.map((f, i) => ({ ...f, hp: i === 0 ? hp : 0 }));
  for (const [hp, margin] of [[800, 'rout'], [400, 'clear'], [100, 'close']]) {
    const pair = at(hp);
    const line = narrate({ t: 1, type: 'ko', winner: 0, loser: 1, endReason: 'ko' }, pair);
    assert.ok(LINES.ko[margin].map((template) => template(pair[0], pair[1])).includes(line.text), `${hp}: ${line.text}`);
  }
});

// Final review: half of all moment tags rode on heavy swings, Reads and surges and never reached the log.
test('a big moment in an exchange or a surge is told too, beside its contest', () => {
  const hits = [{ fighter: 1, amount: 210, moments: ['half'] }, { fighter: 0, amount: 30, moments: [] }];
  const half = LINES.moment.half.map((template) => template(sized[0], sized[1]));
  for (let t = 0; t < 6; t++) {
    const line = narrate({ t, type: 'exchange', source: 'heavy', by: 0, stances: { a: 'overload', b: 'guard' }, outcome: 'a', hits }, sized);
    assert.ok(half.some((sentence) => line.text.includes(sentence)), line.text);
    assert.match(line.text, /\b210\b/);
    const contest = LINES.heavy.guard.map((template) => template(sized[0], sized[1]));
    assert.ok(contest.some((sentence) => line.text.startsWith(sentence)), `the contest went missing: ${line.text}`);
  }
  const surge = narrate({ t: 9, type: 'action', fighter: 0, action: 'surge', amount: 120, moments: ['firstBlood'] }, sized);
  const firstBlood = LINES.moment.firstBlood.map((template) => template(sized[0], sized[1]));
  assert.ok(firstBlood.some((sentence) => surge.text.includes(sentence)), surge.text);
  const plainSurge = narrate({ t: 9, type: 'action', fighter: 0, action: 'surge', amount: 120, moments: [] }, sized);
  assert.ok(!firstBlood.some((sentence) => plainSurge.text.includes(sentence)), plainSurge.text);
});
