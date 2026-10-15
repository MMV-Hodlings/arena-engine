/**
 * The action gauge (spec section 3.3). Both robots share the same base cadence: attack star
 * already drives damage, and letting it also drive frequency would double-count it. Jitter
 * is what makes actions interleave organically instead of alternating like a metronome.
 */

import { randomRange } from './rng.js';
import { ACTION_CADENCE_MS, ACTION_JITTER } from './constants.js';

/**
 * @param {number} state rng state
 * @param {number} nowMs
 * @returns {{value: number, state: number}} absolute timestamp of the next action
 */
export function scheduleNextAction(state, nowMs) {
  const low = ACTION_CADENCE_MS * (1 - ACTION_JITTER);
  const high = ACTION_CADENCE_MS * (1 + ACTION_JITTER);
  const roll = randomRange(state, low, high);
  return { value: nowMs + roll.value, state: roll.state };
}

/**
 * Indices of fighters whose gauge has filled, earliest first, ties broken by index so the
 * order never depends on array sort stability.
 * @param {Array<{nextActionAt: number, hp?: number}>} fighters
 * @param {number} nowMs
 * @returns {number[]}
 */
export function dueFighters(fighters, nowMs) {
  return fighters
    .map((fighter, index) => ({ fighter, index }))
    .filter(({ fighter }) => fighter.nextActionAt <= nowMs && (fighter.hp === undefined || fighter.hp > 0))
    .sort((x, y) => x.fighter.nextActionAt - y.fighter.nextActionAt || x.index - y.index)
    .map(({ index }) => index);
}
