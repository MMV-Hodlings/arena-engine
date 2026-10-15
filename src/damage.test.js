import test from 'node:test';
import assert from 'node:assert';
import { baseDamage, suddenDeathMultiplier, rollDamage, hitsToKill } from './damage.js';
import { hashSeed } from './rng.js';

test('a mirror match takes about ten hits at any tier', () => {
  for (const cp of [94, 296, 604.8]) {
    for (const stars of [1, 3, 5]) {
      const atk = cp * stars;
      const def = cp * stars;
      const hp = cp * stars;
      const hits = hitsToKill({ atk, def, hp });
      assert.ok(hits > 9 && hits < 11, `cp ${cp} stars ${stars} took ${hits} hits`);
    }
  }
});

test('damage scales with the attack-to-defence ratio, not with absolute size', () => {
  const small = baseDamage({ atk: 100, def: 100, actionMult: 1 });
  const large = baseDamage({ atk: 1000, def: 1000, actionMult: 1 });
  assert.ok(Math.abs(large / small - 10) < 1e-9);
});

test('a crushing mismatch kills in one hit', () => {
  const strong = { atk: 604.8 * 5, def: 604.8 * 5 };
  const weak = { atk: 94, def: 94, hp: 94 };
  const damage = baseDamage({ atk: strong.atk, def: weak.def, actionMult: 1 });
  assert.ok(damage > weak.hp, `expected a one-shot, dealt ${damage} against ${weak.hp}`);
});

test('the action multiplier scales damage linearly', () => {
  const normal = baseDamage({ atk: 500, def: 400, actionMult: 1 });
  const overload = baseDamage({ atk: 500, def: 400, actionMult: 1.6 });
  assert.ok(Math.abs(overload / normal - 1.6) < 1e-9);
});

test('a guard deals no damage', () => {
  assert.equal(baseDamage({ atk: 500, def: 400, actionMult: 0 }), 0);
});

test('sudden death is inert before ninety seconds', () => {
  assert.equal(suddenDeathMultiplier(0), 1);
  assert.equal(suddenDeathMultiplier(89_999), 1);
});

test('sudden death compounds every fifteen seconds from ninety', () => {
  assert.ok(Math.abs(suddenDeathMultiplier(90_000) - 1.2) < 1e-9);
  assert.ok(Math.abs(suddenDeathMultiplier(104_999) - 1.2) < 1e-9);
  assert.ok(Math.abs(suddenDeathMultiplier(105_000) - 1.44) < 1e-9);
  assert.ok(Math.abs(suddenDeathMultiplier(120_000) - 1.728) < 1e-9);
});

test('rollDamage stays within the variance band and is deterministic', () => {
  const args = { atk: 500, def: 400, actionMult: 1, momentum: 1, elapsedMs: 0 };
  const expected = baseDamage(args);
  let state = hashSeed('variance');
  for (let i = 0; i < 500; i++) {
    const roll = rollDamage(state, args);
    assert.ok(roll.value >= expected * 0.95 - 1e-9);
    assert.ok(roll.value <= expected * 1.05 + 1e-9);
    state = roll.state;
  }
  assert.equal(rollDamage(hashSeed('fixed'), args).value, rollDamage(hashSeed('fixed'), args).value);
});

test('momentum multiplies the rolled damage', () => {
  const args = { atk: 500, def: 400, actionMult: 1, elapsedMs: 0 };
  const low = rollDamage(hashSeed('m'), { ...args, momentum: 0.8 }).value;
  const high = rollDamage(hashSeed('m'), { ...args, momentum: 1.2 }).value;
  assert.ok(Math.abs(high / low - 1.5) < 1e-9);
});
