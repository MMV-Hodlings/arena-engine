/**
 * The clash event registry. Adding an event is adding a module here and nothing else:
 * battle.js looks events up by id and applies whatever their score returns.
 */

import { weightedPick } from '../rng.js';
import { read } from './read.js';
import { tugOfWar } from './tugOfWar.js';
import { overloadSurge } from './overloadSurge.js';
import { reflexStrike } from './reflexStrike.js';
import { targetingLock } from './targetingLock.js';
import { sequenceLock } from './sequenceLock.js';
import { powerRouting } from './powerRouting.js';

/** id -> event module. */
export const CLASH_EVENTS = Object.freeze({
  [read.id]: read,
  [tugOfWar.id]: tugOfWar,
  [overloadSurge.id]: overloadSurge,
  [reflexStrike.id]: reflexStrike,
  [targetingLock.id]: targetingLock,
  [sequenceLock.id]: sequenceLock,
  [powerRouting.id]: powerRouting,
});

/**
 * Relative likelihood of each event. Every event is equally likely except Power Routing, the
 * breather, at three quarters of the rest (the battle pacing design, 2026-10-19). The Read is
 * drawn like any other event: it used to open on every heavy swing, outside this table, which
 * made it nearly half of all events.
 */
export const CLASH_WEIGHTS = Object.freeze({
  [read.id]: 2,
  [tugOfWar.id]: 2,
  [overloadSurge.id]: 2,
  [reflexStrike.id]: 2,
  [targetingLock.id]: 2,
  [sequenceLock.id]: 2,
  [powerRouting.id]: 1.5,
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
