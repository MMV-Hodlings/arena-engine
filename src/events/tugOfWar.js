/**
 * Tug of War. One bar between the two robots; both players mash and the bar moves toward
 * whoever is mashing harder. The loser eats a bonus hit, so this is the event with the
 * most direct consequence after the Read.
 */

import { emptyMashSide, acceptTaps } from './mash.js';
import { MOMENTUM_SHIFT, BRIEFING_MS } from '../constants.js';

/** How far one clamped tap moves the bar, and how hard the loser is hit. */
const STEP = 0.02;
const BONUS_HIT_MULT = 0.5;

export const tugOfWar = Object.freeze({
  id: 'tugOfWar',
  durationMs: 5000,
  // The window is the skill being tested; the briefing in front of it says what to press.
  briefingMs: BRIEFING_MS,
  momentumShift: MOMENTUM_SHIFT,

  init(rngState) {
    return { value: { a: emptyMashSide(), b: emptyMashSide() }, state: rngState };
  },

  reduce(eventState, input) {
    if (input.player !== 'a' && input.player !== 'b') return eventState;
    return { ...eventState, [input.player]: acceptTaps(eventState[input.player], input.payload, input.atMs) };
  },

  /** Where the bar sits, on 0..1 from b's end to a's. Tap counts stay private. */
  publicState(eventState) {
    const position = Math.max(-1, Math.min(1, (eventState.a.taps - eventState.b.taps) * STEP));
    return { position: (position + 1) / 2 };
  },

  score(eventState) {
    const position = Math.max(-1, Math.min(1, (eventState.a.taps - eventState.b.taps) * STEP));
    const a = (position + 1) / 2;
    const result = { a, b: 1 - a };
    if (position > 0) result.bonusHit = { target: 1, mult: BONUS_HIT_MULT };
    else if (position < 0) result.bonusHit = { target: 0, mult: BONUS_HIT_MULT };
    return result;
  },
});
