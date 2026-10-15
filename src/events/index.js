/**
 * The clash event registry. Adding an event is adding a module here and nothing else:
 * battle.js looks events up by id and applies whatever their score returns.
 */

import { weightedPick } from '../rng.js';
import { read } from './read.js';
import { tugOfWar } from './tugOfWar.js';
import { overloadSurge } from './overloadSurge.js';

/** id -> event module. */
export const CLASH_EVENTS = Object.freeze({
  [read.id]: read,
  [tugOfWar.id]: tugOfWar,
  [overloadSurge.id]: overloadSurge,
});

/**
 * Relative likelihood of each event. The Read is reserved for heavy telegraphs and is
 * never drawn at random, so it carries no weight here.
 */
export const CLASH_WEIGHTS = Object.freeze({
  [tugOfWar.id]: 2,
  [overloadSurge.id]: 2,
});

/**
 * @param {number} rngState
 * @param {{exclude?: string[]}} [ctx]
 * @returns {{value: string|null, state: number}} the id of the event to run, or null
 */
export function pickClashEvent(rngState, ctx = {}) {
  const exclude = new Set(ctx.exclude ?? []);
  const entries = Object.entries(CLASH_WEIGHTS).filter(([id]) => !exclude.has(id));
  if (entries.length === 0) return { value: null, state: rngState };
  return weightedPick(rngState, entries);
}
