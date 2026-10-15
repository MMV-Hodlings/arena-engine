/**
 * Reflex Strike. A ring closes on a target; press when it lines up. Pure execution, equal
 * for both players, and the first press is binding so there is no spamming your way to a
 * good score.
 */

import { randomRange } from '../rng.js';
import { MOMENTUM_SHIFT } from '../constants.js';

const DURATION_MS = 3000;
const TOLERANCE_MS = 350;

export const reflexStrike = Object.freeze({
  id: 'reflexStrike',
  durationMs: DURATION_MS,
  momentumShift: MOMENTUM_SHIFT,

  init(rngState) {
    const roll = randomRange(rngState, DURATION_MS * 0.4, DURATION_MS * 0.85);
    return {
      value: { sweetSpotMs: roll.value, toleranceMs: TOLERANCE_MS, presses: { a: null, b: null } },
      state: roll.state,
    };
  },

  /**
   * The press moment is the input's arrival time, which the reducer has already validated
   * against the open window — never a timestamp from the payload. A client that names its
   * own press time can claim a perfect press the instant the window opens.
   */
  reduce(eventState, input) {
    if (input.player !== 'a' && input.player !== 'b') return eventState;
    if (eventState.presses[input.player] !== null) return eventState;
    const pressAtMs = Number(input.atMs);
    if (!Number.isFinite(pressAtMs)) return eventState;
    return { ...eventState, presses: { ...eventState.presses, [input.player]: pressAtMs } };
  },

  /**
   * The sweet spot is published on purpose: a ring you cannot read is a coin flip, not a
   * skill check. Knowing where it is costs nothing, because the score comes from the
   * server-validated arrival time, which no client controls.
   */
  publicState(eventState) {
    return {
      sweetSpotMs: eventState.sweetSpotMs,
      toleranceMs: eventState.toleranceMs,
      pressed: {
        a: eventState.presses.a !== null,
        b: eventState.presses.b !== null,
      },
    };
  },

  score(eventState) {
    const scoreFor = (press) => {
      if (press === null) return 0;
      const off = Math.abs(press - eventState.sweetSpotMs);
      return Math.max(0, 1 - off / eventState.toleranceMs);
    };
    return { a: scoreFor(eventState.presses.a), b: scoreFor(eventState.presses.b) };
  },
});
