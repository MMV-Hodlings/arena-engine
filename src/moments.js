/**
 * The big moments of a battle, tagged on each hit so narration can mark them (battle pacing
 * design, section 8). Pure: the reducer computes the inputs from state before the hit lands.
 */

import { BIG_HIT_FRACTION, COMEBACK_GAP, STREAK_LENGTH, HALF_HP_FRACTION, LOW_HP_FRACTION } from './constants.js';

/**
 * @param {{
 *   target: {hp: number, maxHp: number},                 the robot hit, BEFORE the hit
 *   attacker: {hp: number, maxHp: number, streak: number}, streak already counting this hit
 *   dealt: number,                                        damage actually taken
 *   firstBlood: boolean,                                  no damage of any kind has landed yet
 * }} hit
 * @returns {Array<'firstBlood'|'half'|'quarter'|'streak'|'comeback'>} in that order
 */
export function hitMoments({ target, attacker, dealt, firstBlood }) {
  if (!(dealt > 0) || !(target?.maxHp > 0)) return [];
  const moments = [];
  const before = target.hp / target.maxHp;
  const after = (target.hp - dealt) / target.maxHp;
  if (firstBlood) moments.push('firstBlood');
  if (before >= HALF_HP_FRACTION && after < HALF_HP_FRACTION) moments.push('half');
  if (before >= LOW_HP_FRACTION && after < LOW_HP_FRACTION) moments.push('quarter');
  if (attacker?.streak === STREAK_LENGTH) moments.push('streak');
  const behind = attacker?.maxHp > 0 ? before - attacker.hp / attacker.maxHp : 0;
  if (behind >= COMEBACK_GAP && dealt >= BIG_HIT_FRACTION * target.maxHp) moments.push('comeback');
  return moments;
}
