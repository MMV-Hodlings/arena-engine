/**
 * Power Routing. Three energy pips, three places to put them, three seconds to decide. No
 * reflex at all: this is the breather, and the accessible option for anyone who cannot
 * mash. It never moves momentum — both sides score a flat 0.5 — and instead hands out
 * buffs that land on the holder's next action.
 */

import { MOMENTUM_SHIFT } from '../constants.js';

const DURATION_MS = 3000;
const PIPS = 3;
const ATK_PER_PIP = 0.15;
const DEF_PER_PIP = 0.15;

function normalisePips(pips) {
  const atk = Number(pips?.atk);
  const def = Number(pips?.def);
  const surge = Number(pips?.surge);
  for (const value of [atk, def, surge]) {
    if (!Number.isInteger(value) || value < 0) return null;
  }
  if (atk + def + surge > PIPS) return null;
  return { atk, def, surge };
}

export const powerRouting = Object.freeze({
  id: 'powerRouting',
  durationMs: DURATION_MS,
  momentumShift: MOMENTUM_SHIFT,

  init(rngState) {
    return { value: { allocations: { a: null, b: null } }, state: rngState };
  },

  reduce(eventState, input) {
    if (input.player !== 'a' && input.player !== 'b') return eventState;
    if (eventState.allocations[input.player] !== null) return eventState;
    const pips = normalisePips(input.payload?.pips);
    if (!pips) return eventState;
    return { ...eventState, allocations: { ...eventState.allocations, [input.player]: pips } };
  },

  /** The pip budget, and whether each side has committed its allocation. */
  publicState(eventState) {
    return {
      pips: PIPS,
      allocated: {
        a: eventState.allocations.a !== null,
        b: eventState.allocations.b !== null,
      },
    };
  },

  score(eventState) {
    const buffFor = (pips) => {
      if (!pips) return {};
      const buff = {};
      if (pips.atk > 0) buff.atkMult = 1 + pips.atk * ATK_PER_PIP;
      if (pips.def > 0) buff.defMult = 1 + pips.def * DEF_PER_PIP;
      if (pips.surge > 0) buff.surge = pips.surge;
      return buff;
    };
    return {
      a: 0.5,
      b: 0.5,
      buffs: { a: buffFor(eventState.allocations.a), b: buffFor(eventState.allocations.b) },
    };
  },
});
