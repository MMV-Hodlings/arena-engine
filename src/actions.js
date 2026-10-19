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

/**
 * The stance triangle's optimal mix: strike 38%, guard 39%, overload 23%. It follows from the
 * margins in resolveStances below (a stance's share is proportional to the margin of the matchup
 * it sits out of). Two things read it: the practice AI, which interpolates towards it with
 * competence, and a heavy swing, whose target answers with a stance drawn from it — against this
 * mix an overload gains nothing on average, so a heavy swing is a gamble and never free damage.
 */
export const OPTIMAL_STANCE_MIX = Object.freeze([
  ['strike', 0.38],
  ['guard', 0.39],
  ['overload', 0.23],
]);

/** Base weights per posture. "heavy" is an overload, settled at once through the stance triangle. */
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
 *   strike   interrupts overload  -> overload cut to 0.75 and exposed at 1.25 taken
 *   overload breaks     guard     -> 1.6 swing, blunted to 40% by the guard, 0.15 chip back
 *   guard    parries    strike    -> 0.25 incoming, 0.55 counter out
 *
 * REBALANCED 2026-10-19. What matters is not the multipliers but the NET swing of each
 * matchup, because a stance's share of optimal play is proportional to the margin of the
 * matchup it sits out of. The three margins are now 0.50 / 0.49 / 0.30, giving an
 * equilibrium of strike 38% / guard 39% / overload 23% — no pick is the default answer.
 *
 * Previously they were 0.20 / 1.60 / 0.10, an equilibrium of 84 / 11 / 5. That table came
 * verbatim from spec section 3.7 and made guard a trap rather than a choice: its worst case
 * was -1.60 against strike's -0.10, sixteen times the downside for one wrong guess. Overload
 * also returned +0.47 against a uniformly random opponent — which is exactly what the
 * practice AI used to play, so practice taught the habit that staked play punishes. It is
 * now -0.003 there, and overload carries the worst downside (-0.50), which is what a gamble
 * should look like.
 *
 * Equal margins were considered and rejected: they produce a uniform 33/33/33 equilibrium,
 * which means the optimal strategy is a dice roll and there is nothing left to read.
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

  // Strike interrupts a wind-up: the overloading robot is caught mid-swing, so its output
  // drops and it is wide open (1.25x taken). Net swing to strike: 0.50.
  if (a === 'strike' && b === 'overload') return { a: side(1, 1), b: side(0.75, 1.25), outcome: 'a' };
  if (a === 'overload' && b === 'strike') return { a: side(0.75, 1.25), b: side(1, 1), outcome: 'b' };

  // Overload beats a guard, but no longer erases it: the guard blunts the swing to 40% and
  // chips back. Net swing to overload: 0.49, down from 1.60.
  if (a === 'overload' && b === 'guard') return { a: side(1.6, 1), b: side(0.15, 0.4), outcome: 'a' };
  if (a === 'guard' && b === 'overload') return { a: side(0.15, 0.4), b: side(1.6, 1), outcome: 'b' };

  // Parry and counter: the strike is cut to a quarter and answered. Net swing to guard: 0.30.
  if (a === 'guard' && b === 'strike') return { a: side(0.55, 0.25), b: side(1, 1), outcome: 'a' };
  if (a === 'strike' && b === 'guard') return { a: side(1, 1), b: side(0.55, 0.25), outcome: 'b' };

  return { a: side(1, 1), b: side(1, 1), outcome: 'tie' };
}
