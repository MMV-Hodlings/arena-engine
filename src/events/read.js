/**
 * The Read (spec section 3.7). A robot telegraphs a heavy swing and both players commit to
 * a stance inside the window. The stance triangle resolves it for real damage, so this is
 * the one event with a large direct effect — which is why its momentum shift is the small
 * one. Not picking means guarding.
 */

import { resolveStances } from '../actions.js';
import { MOMENTUM_SHIFT_READ } from '../constants.js';

const STANCES = ['strike', 'guard', 'overload'];
const DEFAULT_STANCE = 'guard';

export const read = Object.freeze({
  id: 'read',
  durationMs: 3000,
  momentumShift: MOMENTUM_SHIFT_READ,

  /** @param {number} rngState @param {{heavyBy: 0|1}} ctx */
  init(rngState, ctx) {
    return { value: { picks: { a: null, b: null }, heavyBy: ctx?.heavyBy ?? 0 }, state: rngState };
  },

  reduce(eventState, input) {
    const stance = input?.payload?.stance;
    if (!STANCES.includes(stance)) return eventState;
    if (input.player !== 'a' && input.player !== 'b') return eventState;
    if (eventState.picks[input.player] !== null) return eventState; // first pick is binding
    return { ...eventState, picks: { ...eventState.picks, [input.player]: stance } };
  },

  score(eventState) {
    const a = eventState.picks.a ?? DEFAULT_STANCE;
    const b = eventState.picks.b ?? DEFAULT_STANCE;
    const resolved = resolveStances(a, b);
    const scoreFor = (side) =>
      resolved.outcome === 'tie' ? 0.5 : resolved.outcome === side ? 1 : 0;
    return { a: scoreFor('a'), b: scoreFor('b'), exchange: { a, b } };
  },
});
