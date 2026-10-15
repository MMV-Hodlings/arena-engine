/**
 * What a robot does when its action gauge fills, and how two committed stances resolve
 * against each other (spec sections 3.5 and 3.7).
 *
 * Autonomous action choice is posture-weighted and situation-aware, but never consults the
 * opponent's hidden state: it is flavour, not an opponent AI. The policy that plays a
 * practice opponent's clash events lives in ai.js.
 */

import { weightedPick } from './rng.js';
import { SURGE_CHARGES_REQUIRED, LOW_HP_FRACTION } from './constants.js';
import { hasStatus } from './status.js';
import { normalizeElement, NEUTRAL } from './elements.js';

/** Damage multiplier for each action, before stance interactions. */
export const ACTION_MULT = Object.freeze({
  strike: 1,
  overload: 1.6,
  guard: 0,
  surge: 1.3,
  counter: 0.6,
});

/** Base weights per posture. "heavy" is an overload that telegraphs and opens a Read event. */
const POSTURE_WEIGHTS = Object.freeze({
  aggressive: { strike: 5, heavy: 3, guard: 1 },
  balanced: { strike: 5, heavy: 2, guard: 2 },
  defensive: { strike: 4, heavy: 1, guard: 4 },
});

/** Extra weight on guard when reeling, and the weight surge takes when it is available. */
const LOW_HP_GUARD_BONUS = 4;
const SURGE_WEIGHT = 6;

/**
 * @param {number} state rng state
 * @param {{posture: string, hpFraction: number, surgeCharges: number, element: string, statuses: Array}} ctx
 * @returns {{value: string, state: number}} one of strike | heavy | guard | surge
 */
export function chooseAction(state, ctx) {
  // A frozen robot has no choice at all.
  if (hasStatus(ctx.statuses, 'freeze')) return { value: 'guard', state };

  const base = POSTURE_WEIGHTS[ctx.posture] ?? POSTURE_WEIGHTS.balanced;
  const weights = { ...base };

  if (ctx.hpFraction <= LOW_HP_FRACTION) weights.guard += LOW_HP_GUARD_BONUS;

  const surgeReady =
    ctx.surgeCharges >= SURGE_CHARGES_REQUIRED && normalizeElement(ctx.element) !== NEUTRAL;
  if (surgeReady) weights.surge = SURGE_WEIGHT;

  return weightedPick(state, Object.entries(weights));
}

/**
 * The stance triangle. Returns, for each side, the multiplier on the damage it deals and
 * the multiplier on the damage it takes.
 *
 *   strike   interrupts overload  -> the overload drops to 0.8
 *   overload breaks     guard     -> full 1.6, no reduction for the guard
 *   guard    parries    strike    -> 0.5 incoming, 0.6 counter out
 *
 * @param {'strike'|'guard'|'overload'} a
 * @param {'strike'|'guard'|'overload'} b
 * @returns {{a: {damageMult: number, takenMult: number}, b: {damageMult: number, takenMult: number}, outcome: 'a'|'b'|'tie'}}
 */
export function resolveStances(a, b) {
  const side = (damageMult, takenMult) => ({ damageMult, takenMult });

  if (a === b) {
    if (a === 'guard') return { a: side(0, 1), b: side(0, 1), outcome: 'tie' };
    if (a === 'overload') return { a: side(1.6, 1.4), b: side(1.6, 1.4), outcome: 'tie' };
    return { a: side(1, 1), b: side(1, 1), outcome: 'tie' };
  }

  if (a === 'strike' && b === 'overload') return { a: side(1, 1), b: side(0.8, 1), outcome: 'a' };
  if (a === 'overload' && b === 'strike') return { a: side(0.8, 1), b: side(1, 1), outcome: 'b' };

  if (a === 'overload' && b === 'guard') return { a: side(1.6, 1), b: side(0, 1), outcome: 'a' };
  if (a === 'guard' && b === 'overload') return { a: side(0, 1), b: side(1.6, 1), outcome: 'b' };

  if (a === 'guard' && b === 'strike') return { a: side(0.6, 0.5), b: side(1, 1), outcome: 'a' };
  if (a === 'strike' && b === 'guard') return { a: side(1, 1), b: side(0.6, 0.5), outcome: 'b' };

  return { a: side(1, 1), b: side(1, 1), outcome: 'tie' };
}
