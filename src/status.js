/**
 * Status effects (spec section 3.8). One per element, applied by an Element Surge and
 * lasting a number of the afflicted robot's own actions. Durations are counted in actions,
 * not seconds, so a slow fight and a fast fight feel the same.
 *
 * Every function is pure: statuses go in, a new array comes out.
 */

import { statusForElement } from './elements.js';

/** How much of its defence a shocked robot loses. */
const SHOCK_DEFENSE_PENALTY = 0.25;

/** Fraction of max HP a burning robot loses per action. */
const BURN_FRACTION = 0.04;

/** Chance a gusted robot evades the next incoming attack. Consumed on use. */
export const GUST_EVADE_CHANCE = 0.35;

/** Surge charges a drench strips on application. */
export const DRENCH_CHARGE_LOSS = 2;

/**
 * @param {Array<{id: string, remaining: number}>} statuses
 * @param {string} element
 * @returns {{statuses: Array<{id: string, remaining: number}>, applied: {id: string, actions: number}|null}}
 */
export function applyElementStatus(statuses, element) {
  const effect = statusForElement(element);
  if (!effect) return { statuses: statuses.map((s) => ({ ...s })), applied: null };

  const without = statuses.filter((s) => s.id !== effect.id).map((s) => ({ ...s }));
  return {
    statuses: [...without, { id: effect.id, remaining: effect.actions }],
    applied: effect,
  };
}

/** @returns {boolean} */
export function hasStatus(statuses, id) {
  return statuses.some((s) => s.id === id && s.remaining > 0);
}

/** Removes a status outright, for one-shot effects that fire early. */
export function consumeStatus(statuses, id) {
  return statuses.filter((s) => s.id !== id).map((s) => ({ ...s }));
}

/** Decrements every status by one action and drops the expired ones. */
export function tickStatuses(statuses) {
  return statuses
    .map((s) => ({ ...s, remaining: s.remaining - 1 }))
    .filter((s) => s.remaining > 0);
}

/** @returns {number} defence after Shock */
export function effectiveDefense(statuses, def) {
  return hasStatus(statuses, 'shock') ? def * (1 - SHOCK_DEFENSE_PENALTY) : def;
}

/** @returns {number} HP lost to Burn this action */
export function burnDamage(statuses, maxHp) {
  return hasStatus(statuses, 'burn') ? maxHp * BURN_FRACTION : 0;
}
