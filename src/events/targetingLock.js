/**
 * Targeting Lock. A crosshair drifts across the opponent; stop it on the weak point. The
 * drift is a pure function of time so the client can render exactly what the server scores
 * without any state being sent back and forth.
 */

import { randomRange } from '../rng.js';
import { MOMENTUM_SHIFT, BRIEFING_MS } from '../constants.js';

const DURATION_MS = 4000;
/** Score reaches zero at this distance from the weak point, on a -1..1 track. */
const TOLERANCE = 0.5;

export const targetingLock = Object.freeze({
  id: 'targetingLock',
  durationMs: DURATION_MS,
  // The window is the skill being tested; the briefing in front of it says what to press.
  briefingMs: BRIEFING_MS,
  momentumShift: MOMENTUM_SHIFT,

  init(rngState) {
    const phase = randomRange(rngState, 0, Math.PI * 2);
    const period = randomRange(phase.state, 1100, 1800);
    const weak = randomRange(period.state, -0.6, 0.6);
    return {
      value: { phase: phase.value, periodMs: period.value, weakPoint: weak.value, presses: { a: null, b: null } },
      state: weak.state,
    };
  },

  /** Crosshair position on a -1..1 track at time t. */
  positionAt(eventState, ms) {
    return Math.sin((ms / eventState.periodMs) * Math.PI * 2 + eventState.phase);
  },

  /** The first moment the crosshair sits on a given position. Used by tests and by the AI. */
  timeAtPosition(eventState, position) {
    const clamped = Math.max(-1, Math.min(1, position));
    const base = Math.asin(clamped) - eventState.phase;
    const ms = (base / (Math.PI * 2)) * eventState.periodMs;
    return ms < 0 ? ms + eventState.periodMs : ms;
  },

  /** Stop time is the validated arrival time, not a client-supplied one. See reflexStrike. */
  reduce(eventState, input) {
    if (input.player !== 'a' && input.player !== 'b') return eventState;
    if (eventState.presses[input.player] !== null) return eventState;
    const pressAtMs = Number(input.atMs);
    if (!Number.isFinite(pressAtMs)) return eventState;
    return { ...eventState, presses: { ...eventState.presses, [input.player]: pressAtMs } };
  },

  /** Everything needed to draw the drifting crosshair and the weak point it hunts. */
  publicState(eventState) {
    return {
      phase: eventState.phase,
      periodMs: eventState.periodMs,
      weakPoint: eventState.weakPoint,
    };
  },

  score(eventState) {
    const scoreFor = (press) => {
      if (press === null) return 0;
      const distance = Math.abs(targetingLock.positionAt(eventState, press) - eventState.weakPoint);
      return Math.max(0, 1 - distance / TOLERANCE);
    };
    return { a: scoreFor(eventState.presses.a), b: scoreFor(eventState.presses.b) };
  },
});
