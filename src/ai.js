/**
 * The practice-mode opponent. Given an open clash event it plans the inputs a player of a
 * given competence would produce, which the caller then feeds to step() as it would real
 * player input — the engine cannot tell the difference, so practice exercises exactly the
 * same code path as a ranked duel.
 *
 * The balance harness uses the same policy at competence 1 and 0 to measure the real skill
 * ceiling of the simulation.
 */

import { nextRandom, randomRange, randomInt } from './rng.js';
import { CLASH_EVENTS } from './events/index.js';
import { MAX_TAPS_PER_SECOND } from './constants.js';

const POSTURES = ['aggressive', 'balanced', 'defensive'];

/** Competence 0..1 to a tap rate, topping out just under the clamp. */
function tapRateFor(competence) {
  return 2 + competence * (MAX_TAPS_PER_SECOND - 2);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/** Mashing plan: one aggregated message every 100ms, as a real client would send. */
function planMash(clash, player, competence, rngState) {
  const windowMs = 100;
  const windows = Math.floor((clash.endsAt - clash.startedAt) / windowMs);
  const rate = tapRateFor(competence);
  const ceiling = Math.floor((windowMs / 1000) * MAX_TAPS_PER_SECOND);
  const inputs = [];
  let state = rngState;

  for (let i = 0; i < windows; i++) {
    const jitter = nextRandom(state);
    state = jitter.state;
    const taps = Math.max(0, Math.round(((rate * windowMs) / 1000) * (0.8 + jitter.value * 0.4)));
    if (taps === 0) continue;
    inputs.push({
      player,
      payload: { taps: Math.min(taps, ceiling), windowMs, seq: i },
      atMs: clash.startedAt + i * windowMs,
    });
  }
  return { value: inputs, state };
}

/** Timing plan: aim at the target moment, with an error that shrinks as competence rises. */
function planTimedPress(clash, player, competence, rngState, targetMs, spreadMs) {
  const error = randomRange(rngState, -spreadMs, spreadMs);
  const offset = error.value * (1 - clamp01(competence));
  const pressAtMs = Math.max(0, Math.min(clash.endsAt - clash.startedAt, targetMs + offset));
  return {
    value: [{ player, payload: { pressAtMs }, atMs: clash.startedAt + pressAtMs }],
    state: error.state,
  };
}

/**
 * @param {{id: string, eventState: object, startedAt: number, endsAt: number}} clash
 * @param {'a'|'b'} player
 * @param {{competence: number}} options
 * @param {number} rngState
 * @returns {{value: Array<{player: string, payload: object, atMs: number}>, state: number}}
 */
export function planClashInputs(clash, player, options, rngState) {
  const competence = clamp01(options?.competence ?? 0.5);
  const event = CLASH_EVENTS[clash.id];
  if (!event) return { value: [], state: rngState };

  switch (clash.id) {
    case 'tugOfWar':
    case 'overloadSurge':
      return planMash(clash, player, competence, rngState);

    case 'reflexStrike':
      return planTimedPress(
        clash, player, competence, rngState,
        clash.eventState.sweetSpotMs,
        clash.eventState.toleranceMs * 3,
      );

    case 'targetingLock': {
      const perfect = CLASH_EVENTS.targetingLock.timeAtPosition(clash.eventState, clash.eventState.weakPoint);
      return planTimedPress(clash, player, competence, rngState, perfect, clash.eventState.periodMs / 2);
    }

    case 'sequenceLock': {
      // A less competent player gets fewer keys right and takes longer over it.
      const sequence = clash.eventState.sequence;
      const correct = Math.round(sequence.length * competence);
      const keys = [];
      let state = rngState;
      for (let i = 0; i < sequence.length; i++) {
        if (i < correct) {
          keys.push(sequence[i]);
        } else {
          const roll = randomInt(state, 4);
          state = roll.state;
          keys.push(['up', 'down', 'left', 'right'][roll.value]);
        }
      }
      const delay = randomRange(state, 0, event.durationMs * 0.5);
      state = delay.state;
      const atMs = event.durationMs * (1 - competence) * 0.6 + delay.value * (1 - competence);
      const bounded = Math.min(atMs, event.durationMs - 1);
      return {
        value: [{ player, payload: { keys }, atMs: clash.startedAt + bounded }],
        state,
      };
    }

    case 'read': {
      const roll = randomInt(rngState, 3);
      const stance = ['strike', 'guard', 'overload'][roll.value];
      return {
        value: [{ player, payload: { stance }, atMs: clash.startedAt + 500 }],
        state: roll.state,
      };
    }

    case 'powerRouting': {
      const roll = randomInt(rngState, 3);
      const plans = [
        { atk: 2, def: 1, surge: 0 },
        { atk: 1, def: 1, surge: 1 },
        { atk: 0, def: 2, surge: 1 },
      ];
      return {
        value: [{ player, payload: { pips: plans[roll.value] }, atMs: clash.startedAt + 500 }],
        state: roll.state,
      };
    }

    default:
      return { value: [], state: rngState };
  }
}

/** @returns {{value: string, state: number}} */
export function choosePosture(rngState, options = {}) {
  const competence = clamp01(options.competence ?? 0.5);
  // Competent opponents lean balanced; reckless ones swing to the extremes.
  const roll = nextRandom(rngState);
  if (competence > 0.66) return { value: 'balanced', state: roll.state };
  const index = Math.floor(roll.value * POSTURES.length);
  return { value: POSTURES[Math.min(index, POSTURES.length - 1)], state: roll.state };
}
