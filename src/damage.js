/**
 * The damage formula of spec section 3.2:
 *
 *   dmg = ATK x ATK/(ATK + DEF) x K x actionMult x momentum x suddenDeath x variance
 *
 * K = 0.2 is chosen so the formula is scale-invariant: two identical robots always take
 * about ten landed hits to settle, whether they are 94 CP commons or 604 CP elites.
 */

import { K, SUDDEN_DEATH_START_MS, SUDDEN_DEATH_STEP_MS, SUDDEN_DEATH_FACTOR, VARIANCE } from './constants.js';
import { nextRandom } from './rng.js';

/**
 * Damage before momentum, sudden death and variance.
 * @param {{atk: number, def: number, actionMult: number}} args
 * @returns {number}
 */
export function baseDamage({ atk, def, actionMult }) {
  if (actionMult === 0 || atk <= 0) return 0;
  const mitigation = atk / (atk + def);
  return atk * mitigation * K * actionMult;
}

/**
 * From SUDDEN_DEATH_START_MS, damage multiplies by SUDDEN_DEATH_FACTOR every
 * SUDDEN_DEATH_STEP_MS, compounding, so no battle can run forever.
 * @param {number} elapsedMs
 * @returns {number}
 */
export function suddenDeathMultiplier(elapsedMs) {
  if (elapsedMs < SUDDEN_DEATH_START_MS) return 1;
  const steps = Math.floor((elapsedMs - SUDDEN_DEATH_START_MS) / SUDDEN_DEATH_STEP_MS) + 1;
  return SUDDEN_DEATH_FACTOR ** steps;
}

/**
 * The full formula, with seeded variance.
 * @param {number} state rng state
 * @param {{atk: number, def: number, actionMult: number, momentum: number, elapsedMs: number}} args
 * @returns {{value: number, state: number}}
 */
export function rollDamage(state, { atk, def, actionMult, momentum, elapsedMs }) {
  const base = baseDamage({ atk, def, actionMult });
  if (base === 0) return { value: 0, state };
  const roll = nextRandom(state);
  const variance = 1 - VARIANCE + roll.value * VARIANCE * 2;
  const value = base * momentum * suddenDeathMultiplier(elapsedMs) * variance;
  return { value, state: roll.state };
}

/**
 * How many unmodified hits it takes to drop an opponent. Used by tests and the balance
 * harness to reason about pacing; the simulation itself never calls it.
 * @param {{atk: number, def: number, hp: number}} args
 * @returns {number}
 */
export function hitsToKill({ atk, def, hp }) {
  const perHit = baseDamage({ atk, def, actionMult: 1 });
  return perHit === 0 ? Infinity : hp / perHit;
}
