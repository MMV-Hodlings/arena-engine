import test from 'node:test';
import assert from 'node:assert';
import { choreograph } from './choreography.js';

const fighters = [
  { name: 'Dominus', element: 'Fire', maxHp: 600, hp: 600 },
  { name: 'Apex', element: 'Ice', maxHp: 600, hp: 600 },
];

const figureCues = (cues) => cues.filter((cue) => cue.kind === 'figure');
const find = (cues, kind) => cues.find((cue) => cue.kind === kind) ?? null;

test('a strike lunges the attacker, not the defender', () => {
  const cues = choreograph({ type: 'action', fighter: 0, action: 'strike' }, fighters);
  const figures = figureCues(cues);
  assert.equal(figures.length, 1);
  assert.deepEqual(figures[0], { kind: 'figure', side: 'a', animation: 'strike' });
});

test('the second fighter is side b', () => {
  const cues = choreograph({ type: 'action', fighter: 1, action: 'strike' }, fighters);
  assert.equal(figureCues(cues)[0].side, 'b');
});

test('an overload is a bigger swing and shakes the arena', () => {
  const cues = choreograph({ type: 'action', fighter: 0, action: 'overload' }, fighters);
  assert.equal(figureCues(cues)[0].animation, 'heavy');
  assert.equal(find(cues, 'shake').strength, 2);
});

test("the Read's omen is the wind-up on the robot winding up", () => {
  const cues = choreograph({ type: 'omen', id: 'read', fighter: 1 }, fighters);
  assert.deepEqual(figureCues(cues)[0], { kind: 'figure', side: 'b', animation: 'telegraph' });
  assert.equal(find(cues, 'shake'), null, 'nothing has landed yet');
});

test('any other omen glows the robot in its element', () => {
  const cues = choreograph({ type: 'omen', id: 'reflexStrike', fighter: 0 }, fighters);
  const glow = find(cues, 'fx');
  assert.equal(glow.effect, 'aura');
  assert.equal(glow.side, 'a');
  assert.equal(glow.element, 'Fire');
  assert.equal(figureCues(cues).length, 0);
});

test('a heavy swing is a big swing and shakes the arena', () => {
  const cues = choreograph({ type: 'action', fighter: 0, action: 'heavy' }, fighters);
  assert.equal(figureCues(cues)[0].animation, 'heavy');
  assert.equal(find(cues, 'shake').strength, 2);
  assert.ok(cues.some((cue) => cue.kind === 'fx' && cue.effect === 'shockwave'));
});

test('a guard braces and does not attack', () => {
  const cues = choreograph({ type: 'action', fighter: 0, action: 'guard' }, fighters);
  assert.equal(figureCues(cues)[0].animation, 'guard');
});

// An evaded swing still happened, so the attacker still swings — but the defender has to
// visibly get out of the way, or a miss looks identical to a hit that did no damage.
test('an evaded action moves the defender too', () => {
  const cues = choreograph({ type: 'action', fighter: 0, action: 'strike', evaded: true }, fighters);
  const figures = figureCues(cues);
  assert.deepEqual(figures.map((cue) => [cue.side, cue.animation]), [['a', 'strike'], ['b', 'evade']]);
});

test('damage recoils the victim and names the attacker element for the tint', () => {
  // Fire hit Ice: the flash is the attacker's element, which is what the hit is made of.
  const cues = choreograph({ type: 'damage', fighter: 1, amount: 40, hpAfter: 560, source: 'action' }, fighters);
  assert.deepEqual(figureCues(cues)[0], { kind: 'figure', side: 'b', animation: 'hurt' });
  const impact = find(cues, 'fx');
  assert.equal(impact.effect, 'impact');
  assert.equal(impact.side, 'b');
  assert.equal(impact.element, 'Fire');
});

test('a damage number carries the amount, rounded the way a player reads it', () => {
  const cues = choreograph({ type: 'damage', fighter: 1, amount: 40.6, hpAfter: 559, source: 'action' }, fighters);
  const number = cues.find((cue) => cue.kind === 'fx' && cue.effect === 'damageNumber');
  assert.equal(number.amount, 41);
  assert.equal(number.side, 'b');
});

test('a big hit staggers where a small one only flinches', () => {
  const small = choreograph({ type: 'damage', fighter: 1, amount: 20, hpAfter: 580, source: 'action' }, fighters);
  const big = choreograph({ type: 'damage', fighter: 1, amount: 140, hpAfter: 460, source: 'action' }, fighters);
  assert.equal(figureCues(small)[0].animation, 'hurt');
  assert.equal(figureCues(big)[0].animation, 'stagger');
});

test('shake scales with the fraction of max hp, so a chip is not an earthquake', () => {
  const chip = choreograph({ type: 'damage', fighter: 1, amount: 6, hpAfter: 594, source: 'action' }, fighters);
  const solid = choreograph({ type: 'damage', fighter: 1, amount: 45, hpAfter: 555, source: 'action' }, fighters);
  const huge = choreograph({ type: 'damage', fighter: 1, amount: 150, hpAfter: 450, source: 'action' }, fighters);
  assert.equal(find(chip, 'shake'), null, 'a 1% chip should not move the camera');
  assert.equal(find(solid, 'shake').strength, 1);
  assert.equal(find(huge, 'shake').strength, 2);
});

// Burn ticks arrive as damage with source 'status'. They are constant, so giving them the
// full hit treatment would shake the arena every second of a burn.
test('a burn tick is not staged like a landed blow', () => {
  const cues = choreograph({ type: 'damage', fighter: 1, amount: 45, hpAfter: 555, source: 'status' }, fighters);
  assert.equal(find(cues, 'shake'), null);
  assert.equal(figureCues(cues).length, 0);
  assert.ok(cues.find((cue) => cue.kind === 'fx' && cue.effect === 'damageNumber'));
});

test('a status landing pulses an aura in that element, and expiring does not', () => {
  const applied = choreograph({ type: 'status', fighter: 1, id: 'burn', applied: true }, fighters);
  const aura = find(applied, 'fx');
  assert.equal(aura.effect, 'aura');
  assert.equal(aura.element, 'Fire', 'burn is the Fire status');
  assert.equal(aura.side, 'b');
  assert.deepEqual(choreograph({ type: 'status', fighter: 1, id: 'burn', applied: false }, fighters), []);
});

test('every status id maps to an element rather than falling through untinted', () => {
  const byId = { burn: 'Fire', freeze: 'Ice', shock: 'Lightning', gust: 'Air', quake: 'Earth', drench: 'Water' };
  for (const [id, element] of Object.entries(byId)) {
    const cues = choreograph({ type: 'status', fighter: 0, id, applied: true }, fighters);
    assert.equal(find(cues, 'fx').element, element, id);
  }
});

test('a clash opens bullet time and closing it ends bullet time', () => {
  assert.equal(find(choreograph({ type: 'clashStart', id: 'read' }, fighters), 'bulletTime').on, true);
  assert.equal(find(choreograph({ type: 'clashEnd', id: 'read' }, fighters), 'bulletTime').on, false);
});

test('a ko drops the loser and never the winner', () => {
  const cues = choreograph({ type: 'ko', winner: 0, loser: 1, endReason: 'ko' }, fighters);
  const figures = figureCues(cues);
  assert.deepEqual(figures, [{ kind: 'figure', side: 'b', animation: 'ko' }]);
  assert.equal(find(cues, 'shake').strength, 2);
});

// Review Focus 4: a battle must never end with bullet time still on, whatever was open
// when the last blow landed.
test('a ko releases bullet time, even one a clash opened a moment earlier', () => {
  const cues = choreograph({ type: 'ko', winner: 1, loser: 0, endReason: 'ko' }, fighters);
  assert.equal(find(cues, 'bulletTime').on, false);
});

test('a timeout settles both robots without dropping either', () => {
  const cues = choreograph({ type: 'ko', winner: 0, loser: 1, endReason: 'timeout' }, fighters);
  assert.equal(figureCues(cues).length, 0, 'nobody falls over when the clock runs out');
  assert.equal(find(cues, 'bulletTime').on, false);
});

test('an unknown event is ignored rather than throwing mid-battle', () => {
  assert.deepEqual(choreograph({ type: 'somethingNew', fighter: 0 }, fighters), []);
  assert.deepEqual(choreograph({ type: 'action', fighter: 0, action: 'unheardOf' }, fighters), []);
});

test('a missing fighter list does not break the stage', () => {
  assert.doesNotThrow(() => choreograph({ type: 'damage', fighter: 1, amount: 10, source: 'action' }, []));
  assert.doesNotThrow(() => choreograph({ type: 'action', fighter: 0, action: 'strike' }, undefined));
});

test('a fighter index outside the pair produces nothing rather than a cue for side undefined', () => {
  assert.deepEqual(choreograph({ type: 'action', fighter: 7, action: 'strike' }, fighters), []);
  assert.deepEqual(choreograph({ type: 'damage', fighter: -1, amount: 10, source: 'action' }, fighters), []);
});

test('damage against a robot with no known maxHp still flashes, just without a shake', () => {
  const cues = choreograph(
    { type: 'damage', fighter: 1, amount: 40, source: 'action' },
    [fighters[0], { name: 'Apex', element: 'Ice' }],
  );
  assert.equal(find(cues, 'shake'), null, 'no maxHp means no fraction to scale by');
  assert.equal(find(cues, 'fx').effect, 'impact');
});

// ── Deferred minor #5: an exchange's stances show on stage ──

test("a heavy swing's answer shows on the robot answering", () => {
  const cues = choreograph({ type: 'exchange', source: 'heavy', by: 0, stances: { a: 'overload', b: 'guard' }, outcome: 'a', hits: [] }, fighters);
  // The swinger already moved on its own `heavy` action; only the answer is new.
  assert.deepEqual(figureCues(cues).map((cue) => [cue.side, cue.animation]), [['b', 'guard']]);
  const struck = choreograph({ type: 'exchange', source: 'heavy', by: 1, stances: { a: 'strike', b: 'overload' }, outcome: 'a', hits: [] }, fighters);
  assert.deepEqual(figureCues(struck).map((cue) => [cue.side, cue.animation]), [['a', 'strike']]);
});

test('a Read shows both stances, an overload as a heavy swing', () => {
  const cues = choreograph({ type: 'exchange', source: 'read', by: 0, stances: { a: 'strike', b: 'overload' }, outcome: 'a', hits: [] }, fighters);
  assert.deepEqual(figureCues(cues).map((cue) => [cue.side, cue.animation]), [['a', 'strike'], ['b', 'heavy']]);
});

test("an exchange's damage flashes and counts but leaves the stances standing", () => {
  const cues = choreograph({ type: 'damage', fighter: 1, amount: 120, hpAfter: 480, source: 'exchange' }, fighters);
  assert.equal(figureCues(cues).length, 0, 'a recoil would overwrite the stance the exchange just showed');
  assert.ok(cues.some((cue) => cue.kind === 'fx' && cue.effect === 'impact'));
  assert.ok(cues.some((cue) => cue.kind === 'fx' && cue.effect === 'damageNumber' && cue.amount === 120));
});
