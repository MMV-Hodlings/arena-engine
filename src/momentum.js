/**
 * Momentum is the engine's single skill channel (spec section 3.6). Clash event outcomes
 * move it; it multiplies all damage a player deals until the next event, so it covers the
 * whole battle rather than one hit. The clamp is what keeps skill worth +/-20% and no more.
 */

import { MOMENTUM_MIN, MOMENTUM_MAX, MOMENTUM_START, MOMENTUM_SHIFT } from './constants.js';

export { MOMENTUM_START };

/** @param {number} value @returns {number} */
export function clampMomentum(value) {
  if (Number.isNaN(value)) return MOMENTUM_START;
  return Math.min(MOMENTUM_MAX, Math.max(MOMENTUM_MIN, value));
}

/**
 * Maps a clash score in [0, 1] onto a shift in [-maxShift, +maxShift]: 1 is a full gain,
 * 0.5 is neutral, 0 is a full loss.
 * @param {number} current
 * @param {number} score 0..1
 * @param {number} [maxShift]
 * @returns {number}
 */
export function shiftMomentum(current, score, maxShift = MOMENTUM_SHIFT) {
  const bounded = Math.min(1, Math.max(0, score));
  return clampMomentum(current + (bounded * 2 - 1) * maxShift);
}

/**
 * @param {{a: number, b: number}} momenta
 * @param {{a: number, b: number}} scores
 * @param {number} [maxShift]
 * @returns {{a: number, b: number}}
 */
export function applyClashScores(momenta, scores, maxShift = MOMENTUM_SHIFT) {
  return {
    a: shiftMomentum(momenta.a, scores.a, maxShift),
    b: shiftMomentum(momenta.b, scores.b, maxShift),
  };
}
