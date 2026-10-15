/**
 * Pure seeded randomness. Every function takes a 32-bit unsigned integer state and
 * returns the drawn value together with the next state, so callers thread state through
 * explicitly and nothing in the engine ever touches Math.random().
 *
 * The generator is mulberry32: small, fast, and good enough for game feel. It is NOT
 * cryptographic and must never be used for anything security-bearing.
 */

/** FNV-1a. Turns a battle id into a starting state. @param {string} str @returns {number} */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** @param {number} state @returns {{value: number, state: number}} value in [0, 1) */
export function nextRandom(state) {
  const next = (state + 0x6d2b79f5) >>> 0;
  let x = next;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  const value = ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  return { value, state: next };
}

/** @returns {{value: number, state: number}} value in [min, max) */
export function randomRange(state, min, max) {
  const r = nextRandom(state);
  return { value: min + r.value * (max - min), state: r.state };
}

/** @returns {{value: number, state: number}} integer in [0, maxExclusive) */
export function randomInt(state, maxExclusive) {
  const r = nextRandom(state);
  return { value: Math.floor(r.value * maxExclusive), state: r.state };
}

/**
 * Weighted choice. Zero- and negative-weight entries can never be drawn.
 * @param {number} state
 * @param {Array<[*, number]>} entries
 * @returns {{value: *, state: number}}
 */
export function weightedPick(state, entries) {
  const usable = entries.filter(([, weight]) => weight > 0);
  if (usable.length === 0) throw new Error('weightedPick: no entry has a positive weight');
  const total = usable.reduce((sum, [, weight]) => sum + weight, 0);
  const r = nextRandom(state);
  let threshold = r.value * total;
  for (const [key, weight] of usable) {
    threshold -= weight;
    if (threshold < 0) return { value: key, state: r.state };
  }
  return { value: usable[usable.length - 1][0], state: r.state };
}
