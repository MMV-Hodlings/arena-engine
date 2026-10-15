/**
 * Sequence Lock. A short directional sequence flashes up and both players race to repeat
 * it. Accuracy is the floor, speed is the multiplier. A wrong key ends the run where it
 * went wrong, so partial credit is real but capped.
 */

import { randomInt } from '../rng.js';
import { MOMENTUM_SHIFT } from '../constants.js';

const DURATION_MS = 5000;
const KEYS = ['up', 'down', 'left', 'right'];
const LENGTH = 5;
/** Share of the score that comes from accuracy; the rest comes from speed. */
const ACCURACY_WEIGHT = 0.7;

export const sequenceLock = Object.freeze({
  id: 'sequenceLock',
  durationMs: DURATION_MS,
  momentumShift: MOMENTUM_SHIFT,

  init(rngState) {
    const sequence = [];
    let state = rngState;
    for (let i = 0; i < LENGTH; i++) {
      const roll = randomInt(state, KEYS.length);
      sequence.push(KEYS[roll.value]);
      state = roll.state;
    }
    return { value: { sequence, entries: { a: null, b: null } }, state };
  },

  reduce(eventState, input) {
    if (input.player !== 'a' && input.player !== 'b') return eventState;
    if (eventState.entries[input.player] !== null) return eventState;
    const keys = input.payload?.keys;
    if (!Array.isArray(keys)) return eventState;
    const atMs = Number(input.atMs);
    if (!Number.isFinite(atMs)) return eventState;
    return {
      ...eventState,
      entries: { ...eventState.entries, [input.player]: { keys: keys.slice(0, LENGTH), atMs } },
    };
  },

  /** The sequence itself; repeating it quickly and correctly is the skill. */
  publicState(eventState) {
    return {
      sequence: [...eventState.sequence],
      entered: {
        a: eventState.entries.a !== null,
        b: eventState.entries.b !== null,
      },
    };
  },

  score(eventState) {
    const scoreFor = (entry) => {
      if (!entry) return 0;
      let correct = 0;
      for (let i = 0; i < eventState.sequence.length; i++) {
        if (entry.keys[i] !== eventState.sequence[i]) break;
        correct++;
      }
      const accuracy = correct / eventState.sequence.length;
      if (accuracy === 0) return 0;
      const speed = Math.max(0, 1 - entry.atMs / DURATION_MS);
      return accuracy * (ACCURACY_WEIGHT + (1 - ACCURACY_WEIGHT) * speed);
    };
    return { a: scoreFor(eventState.entries.a), b: scoreFor(eventState.entries.b) };
  },
});
