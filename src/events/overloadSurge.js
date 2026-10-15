/**
 * Overload Surge. No contest: each player fills their own gauge inside the window, so both
 * can score full marks. The target rate sits well under the server clamp, which means a
 * committed human reaches it and an autoclicker gains nothing.
 */

import { emptyMashSide, acceptTaps } from './mash.js';
import { MOMENTUM_SHIFT } from '../constants.js';

/** Taps needed to fill the gauge across the window: 6 per second over 4 seconds. */
const TARGET_TAPS = 24;

export const overloadSurge = Object.freeze({
  id: 'overloadSurge',
  durationMs: 4000,
  momentumShift: MOMENTUM_SHIFT,

  init(rngState) {
    return { value: { a: emptyMashSide(), b: emptyMashSide() }, state: rngState };
  },

  reduce(eventState, input) {
    if (input.player !== 'a' && input.player !== 'b') return eventState;
    return { ...eventState, [input.player]: acceptTaps(eventState[input.player], input.payload, input.atMs) };
  },

  /** How full each gauge is, which is what the client draws. */
  publicState(eventState) {
    const fill = (side) => Math.min(1, side.taps / TARGET_TAPS);
    return { target: TARGET_TAPS, fill: { a: fill(eventState.a), b: fill(eventState.b) } };
  },

  score(eventState) {
    const fill = (side) => Math.min(1, side.taps / TARGET_TAPS);
    return { a: fill(eventState.a), b: fill(eventState.b) };
  },
});
