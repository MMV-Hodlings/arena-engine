/**
 * The Read (spec section 3.7). A robot telegraphs a heavy swing and both players commit to
 * a stance inside the window. The stance triangle resolves it for real damage, so this is
 * the one event with a large direct effect — which is why its momentum shift is the small
 * one. Not picking means guarding.
 */

import { resolveStances } from '../actions.js';
import { MOMENTUM_SHIFT_READ, DECISION_WINDOW_MS } from '../constants.js';

const STANCES = ['strike', 'guard', 'overload'];
const DEFAULT_STANCE = 'guard';

export const read = Object.freeze({
  id: 'read',
  // Fifteen seconds to choose, closing the moment both have (see `settled`).
  durationMs: DECISION_WINDOW_MS,
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

  /**
   * Only who is winding up.
   *
   * An earlier version also published whether each side had committed, which is a free
   * win: poll it at tick resolution, wait for the opponent to commit or run out of time,
   * then move last with the counter. Stance reads sit outside SKILL_INFLUENCE_CAP, so
   * unlike every other clash event that edge is unbounded. A client knows its own pick
   * without being told, and must not learn anything about the other.
   */
  publicState(eventState) {
    return { heavyBy: eventState.heavyBy };
  },

  /**
   * Settled once both players have picked. Closing early leaks nothing: a pick is binding the
   * moment it is made and the window only closes once both have picked, so a player who has not
   * picked yet sees an open window whatever the opponent has done.
   */
  settled(eventState) {
    return eventState.picks.a !== null && eventState.picks.b !== null;
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
