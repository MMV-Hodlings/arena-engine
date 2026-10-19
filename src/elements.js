/**
 * The element system of whitepaper section 8, plus the status effects the arena design
 * layers on top. The multipliers are the whitepaper's and are not negotiable; the status
 * effects are an addition and are balance-tunable.
 */

export const NEUTRAL = 'Neutral';

/** The six elements, canonically cased. */
export const ELEMENTS = ['Air', 'Earth', 'Fire', 'Ice', 'Lightning', 'Water'];

/**
 * Two three-cycles: Earth > Lightning > Air > Earth, and Fire > Ice > Water > Fire.
 * Elements from different cycles never interact.
 */
const BEATS = {
  Earth: 'Lightning',
  Lightning: 'Air',
  Air: 'Earth',
  Fire: 'Ice',
  Ice: 'Water',
  Water: 'Fire',
};

const STATUS_BY_ELEMENT = {
  Fire: { id: 'burn', actions: 3 },
  Ice: { id: 'freeze', actions: 1 },
  Lightning: { id: 'shock', actions: 2 },
  // Gust is the one status that guards the surging robot rather than afflicting its target
  // (owner's call, 2026-10-19). Two actions, because the surge's own action ticks it once: it
  // then lasts until the Air robot acts again, or until an attack on it uses it up.
  Air: { id: 'gust', actions: 2, self: true },
  Earth: { id: 'quake', actions: 1 },
  Water: { id: 'drench', actions: 2 },
};

const CANONICAL = new Map(ELEMENTS.map((e) => [e.toLowerCase(), e]));

/**
 * Anything we do not recognise is Neutral. On-chain data is hand-entered and arrives as
 * strings; an unknown value must never throw and must never grant an advantage.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeElement(value) {
  if (typeof value !== 'string') return NEUTRAL;
  return CANONICAL.get(value.trim().toLowerCase()) ?? NEUTRAL;
}

/**
 * Whitepaper section 8: advantaged element +10%, any element against a Neutral +5%,
 * everything else nothing. The disadvantaged side is never penalised.
 * @returns {number} 1.1, 1.05 or 1
 */
export function elementMultiplier(mine, theirs) {
  const a = normalizeElement(mine);
  const b = normalizeElement(theirs);
  if (a === NEUTRAL) return 1;
  if (b === NEUTRAL) return 1.05;
  return BEATS[a] === b ? 1.1 : 1;
}

/**
 * @param {unknown} element
 * @returns {{id: string, actions: number, self?: boolean} | null} null for Neutral and anything
 *   unknown; `self` marks a status that lands on the surging robot instead of its target
 */
export function statusForElement(element) {
  const canonical = normalizeElement(element);
  const status = STATUS_BY_ELEMENT[canonical];
  return status ? { ...status } : null;
}
