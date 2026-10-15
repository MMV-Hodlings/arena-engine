import test from 'node:test';
import assert from 'node:assert';
import { validateChassis, toFighter, combatIndex, deriveCombat } from './stats.js';

/** A chassis exactly as ca-my-assets returns it: numbers arrive as strings. */
const chassis = (overrides = {}) => ({
  asset_id: '1099992035100',
  name: 'Onerion',
  clan: 'Onerion',
  core_power: 564,
  immutable_data: {
    cp: '564',
    ci: 0,
    pi: 93.3,
    xp: '0',
    element: 'Air',
    wins: '0',
    losses: '0',
    'attack star': '3',
    'defense star': '2',
    'hp star': '3',
    'pvp ready': '1',
    'modules equipped': '5',
    'module sync count': '3',
    'module sync bonus %': 5,
    helmet: '1099992030001',
    'torso armor': '1099992030002',
    'leg armor': '1099992030003',
    weapon: '1099992030004',
    'back gear': '1099992030005',
    ...overrides,
  },
});

test('a valid assembled PvP-ready chassis passes validation', () => {
  assert.deepEqual(validateChassis(chassis()), { ok: true, reason: null });
});

// Review Focus 1: strings, zeroes and missing fields.
test('string stats are coerced to numbers', () => {
  const fighter = toFighter(chassis());
  assert.equal(fighter.cp, 564);
  assert.deepEqual(fighter.stars, { attack: 3, defense: 2, hp: 3 });
  assert.equal(typeof fighter.cp, 'number');
});

test('a never-activated robot is rejected rather than given zero HP', () => {
  const result = validateChassis(chassis({ 'pvp ready': '0', 'attack star': '0', 'defense star': '0', 'hp star': '0' }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /pvp ready/i);
});

test('zero stars are rejected even when the pvp ready flag is set', () => {
  const result = validateChassis(chassis({ 'hp star': '0' }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /hp star/i);
});

test('an unassembled chassis is rejected', () => {
  const result = validateChassis(chassis({ 'modules equipped': '3' }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /modules/i);
});

test('missing stat fields are rejected, not treated as zero', () => {
  const asset = chassis();
  delete asset.immutable_data['attack star'];
  const result = validateChassis(asset);
  assert.equal(result.ok, false);
  assert.match(result.reason, /attack star/i);
});

test('a non-numeric cp is rejected', () => {
  assert.equal(validateChassis(chassis({ cp: 'n/a' })).ok, false);
});

test('stars above five are rejected', () => {
  assert.equal(validateChassis(chassis({ 'attack star': '6' })).ok, false);
});

test('toFighter throws on an invalid chassis', () => {
  assert.throws(() => toFighter(chassis({ 'modules equipped': '0' })), /modules/i);
});

test('toFighter defaults the posture to balanced and accepts an override', () => {
  assert.equal(toFighter(chassis()).posture, 'balanced');
  assert.equal(toFighter(chassis(), { posture: 'aggressive' }).posture, 'aggressive');
});

test('an unknown posture falls back to balanced', () => {
  assert.equal(toFighter(chassis(), { posture: 'reckless' }).posture, 'balanced');
});

test('combat index is total CS over 9072', () => {
  const fighter = toFighter(chassis());
  // 564 * (3 + 2 + 3) / 9072
  assert.ok(Math.abs(combatIndex(fighter) - (564 * 8) / 9072) < 1e-9);
});

test('a maxed robot has a combat index of 1', () => {
  const maxed = toFighter(
    chassis({ cp: '604.8', 'attack star': '5', 'defense star': '5', 'hp star': '5' }),
  );
  assert.ok(Math.abs(combatIndex(maxed) - 1) < 1e-9);
});

test('deriveCombat applies the element multiplier to every stat', () => {
  const fighter = toFighter(chassis()); // Air
  const combat = deriveCombat(fighter, 'Earth'); // Air beats Earth
  assert.equal(combat.elementMult, 1.1);
  assert.ok(Math.abs(combat.effCp - 564 * 1.1) < 1e-9);
  assert.ok(Math.abs(combat.atk - 564 * 1.1 * 3) < 1e-9);
  assert.ok(Math.abs(combat.def - 564 * 1.1 * 2) < 1e-9);
  assert.ok(Math.abs(combat.hp - 564 * 1.1 * 3) < 1e-9);
});

test('equipped set names are carried through for narration', () => {
  const fighter = toFighter(chassis(), { sets: { helmet: 'Astra', weapon: 'Nova' } });
  assert.equal(fighter.sets.helmet, 'Astra');
  assert.equal(fighter.sets.weapon, 'Nova');
  assert.equal(fighter.sets.legs, null);
});
