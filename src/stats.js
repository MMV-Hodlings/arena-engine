/**
 * Turns a chassis asset, exactly as ca-my-assets returns it, into the fighter the engine
 * simulates. Every numeric field on chain is a string ("564", "3") and some are absent on
 * older mints, so coercion and validation happen here and nowhere else.
 */

import { normalizeElement, elementMultiplier } from './elements.js';
import { MAX_TOTAL_CS } from './constants.js';

const STAR_FIELDS = {
  attack: 'attack star',
  defense: 'defense star',
  hp: 'hp star',
};

const SET_FIELDS = {
  helmet: 'helmet',
  torso: 'torso armor',
  legs: 'leg armor',
  weapon: 'weapon',
  back: 'back gear',
};

const POSTURES = ['aggressive', 'balanced', 'defensive'];

/** Strict numeric coercion: "3" is 3, "" and "n/a" and undefined are null. */
function strictNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {object} asset a chassis from ca-my-assets
 * @returns {{ok: boolean, reason: string|null}}
 */
export function validateChassis(asset) {
  const data = asset?.immutable_data;
  if (!data || typeof data !== 'object') return { ok: false, reason: 'asset has no immutable_data' };

  const equipped = strictNumber(data['modules equipped']);
  if (equipped !== 5) {
    return { ok: false, reason: `robot is not fully assembled: modules equipped is ${data['modules equipped']}` };
  }

  if (strictNumber(data['pvp ready']) !== 1) {
    return { ok: false, reason: 'robot is not pvp ready: activate it with a PvP-Ready NFT' };
  }

  const cp = strictNumber(data.cp ?? asset.core_power);
  if (cp === null || cp <= 0) return { ok: false, reason: `cp is not a positive number: ${data.cp}` };

  for (const field of Object.values(STAR_FIELDS)) {
    const star = strictNumber(data[field]);
    if (star === null) return { ok: false, reason: `${field} is missing or not a number` };
    if (star < 1 || star > 5 || !Number.isInteger(star)) {
      return { ok: false, reason: `${field} must be a whole number from 1 to 5, got ${star}` };
    }
  }

  return { ok: true, reason: null };
}

/**
 * @param {object} asset
 * @param {{posture?: string, sets?: Record<string, string|null>}} [options]
 * @returns {object} fighter
 */
export function toFighter(asset, options = {}) {
  const check = validateChassis(asset);
  if (!check.ok) throw new Error(`cannot build fighter: ${check.reason}`);

  const data = asset.immutable_data;
  const sets = {};
  for (const key of Object.keys(SET_FIELDS)) sets[key] = options.sets?.[key] ?? null;

  return {
    assetId: String(asset.asset_id),
    name: asset.name ?? data.name ?? 'Unknown',
    clan: asset.clan ?? null,
    element: normalizeElement(data.element),
    cp: strictNumber(data.cp ?? asset.core_power),
    stars: {
      attack: strictNumber(data[STAR_FIELDS.attack]),
      defense: strictNumber(data[STAR_FIELDS.defense]),
      hp: strictNumber(data[STAR_FIELDS.hp]),
    },
    posture: POSTURES.includes(options.posture) ? options.posture : 'balanced',
    sets,
  };
}

/**
 * Whitepaper section 9: total CS over the highest possible total CS.
 * @param {object} fighter
 * @returns {number} 0..1
 */
export function combatIndex(fighter) {
  const starTotal = fighter.stars.attack + fighter.stars.defense + fighter.stars.hp;
  return (fighter.cp * starTotal) / MAX_TOTAL_CS;
}

/**
 * Combat stats, with the element multiplier applied to CP before the stars, per the
 * whitepaper. The multiplier depends on the opponent, so this is computed per matchup.
 * @param {object} fighter
 * @param {string} opponentElement
 */
export function deriveCombat(fighter, opponentElement) {
  const mult = elementMultiplier(fighter.element, opponentElement);
  const effCp = fighter.cp * mult;
  return {
    elementMult: mult,
    effCp,
    atk: effCp * fighter.stars.attack,
    def: effCp * fighter.stars.defense,
    hp: effCp * fighter.stars.hp,
  };
}
