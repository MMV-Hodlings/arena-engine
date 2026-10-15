/**
 * The battle reducer (spec section 3.3). A pure state machine:
 *
 *     createBattle({seed, a, b}) -> state
 *     step(state, input)         -> {state, events}
 *
 * The caller owns the clock. `step` never reads the time, never rolls a number that is not
 * drawn from the seeded generator in state, and never mutates its argument. The whole state
 * is JSON-serialisable so a Durable Object can store and restore it verbatim.
 *
 * Phases: intro -> fighting -> ended. Task 10 inserts a 'clash' phase between actions.
 */

import { hashSeed, nextRandom } from './rng.js';
import { deriveCombat, combatIndex } from './stats.js';
import { rollDamage, suddenDeathMultiplier } from './damage.js';
import { MOMENTUM_START } from './momentum.js';
import {
  applyElementStatus, tickStatuses, hasStatus, consumeStatus,
  effectiveDefense, burnDamage, GUST_EVADE_CHANCE, DRENCH_CHARGE_LOSS,
} from './status.js';
import { ACTION_MULT, chooseAction } from './actions.js';
import { scheduleNextAction, dueFighters } from './timeline.js';
import {
  ENGINE_VERSION, INTRO_MS, MAX_TICK_STEP_MS, MAX_BATTLE_MS,
  SURGE_CHARGES_REQUIRED, SUDDEN_DEATH_START_MS, BIG_HIT_FRACTION,
} from './constants.js';

/**
 * @param {{seed: string, a: object, b: object}} args fighters come from stats.toFighter
 * @returns {object} battle state
 */
export function createBattle({ seed, a, b }) {
  const combatA = deriveCombat(a, b.element);
  const combatB = deriveCombat(b, a.element);

  const build = (fighter, combat) => ({
    assetId: fighter.assetId,
    name: fighter.name,
    clan: fighter.clan,
    element: fighter.element,
    posture: fighter.posture,
    sets: fighter.sets,
    stars: fighter.stars,
    cp: fighter.cp,
    ci: combatIndex(fighter),
    combat,
    hp: combat.hp,
    maxHp: combat.hp,
    momentum: MOMENTUM_START,
    surge: 0,
    statuses: [],
    nextActionAt: Infinity,
    actionsTaken: 0,
  });

  return {
    version: ENGINE_VERSION,
    seed,
    rng: hashSeed(seed),
    phase: 'intro',
    clockMs: 0,
    fighters: [build(a, combatA), build(b, combatB)],
    winner: null,
    endReason: null,
    actionCount: 0,
    suddenDeathAnnounced: false,
  };
}

/**
 * @param {object} state
 * @param {{type: string, toMs?: number}} input
 * @returns {{state: object, events: object[]}}
 */
export function step(state, input) {
  if (!input || input.type !== 'tick') return { state, events: [] };
  if (state.phase === 'ended') return { state, events: [] };

  // Review Focus 5: a backwards tick (clock skew) changes nothing, and a very large jump
  // (a Durable Object waking from hibernation) advances by one bounded slice only, so a
  // burst of actions can never resolve inside a single step with nothing rendered between.
  const target = Math.min(input.toMs, state.clockMs + MAX_TICK_STEP_MS);
  if (target <= state.clockMs) return { state, events: [] };

  const next = cloneState(state);
  const events = [];
  advanceTo(next, target, events);
  return { state: next, events };
}

/** Structured clone of the parts that change. Cheap: the state is small and flat. */
function cloneState(state) {
  return {
    ...state,
    fighters: state.fighters.map((f) => ({
      ...f,
      stars: { ...f.stars },
      combat: { ...f.combat },
      sets: { ...f.sets },
      statuses: f.statuses.map((s) => ({ ...s })),
    })),
  };
}

function advanceTo(state, target, events) {
  if (state.phase === 'intro') {
    if (target < INTRO_MS) {
      state.clockMs = target;
      return;
    }
    state.clockMs = INTRO_MS;
    state.phase = 'fighting';
    const first = scheduleNextAction(state.rng, state.clockMs);
    const second = scheduleNextAction(first.state, state.clockMs);
    state.fighters[0].nextActionAt = first.value;
    state.fighters[1].nextActionAt = second.value;
    state.rng = second.state;
    events.push({ t: state.clockMs, type: 'fightStart' });
  }

  // Resolve every action whose gauge filled inside this slice, in time order.
  for (let guard = 0; guard < 16; guard++) {
    if (state.phase === 'ended') return;
    const due = dueFighters(state.fighters, target);
    if (due.length === 0) break;
    const index = due[0];
    state.clockMs = Math.max(state.clockMs, state.fighters[index].nextActionAt);
    announceSuddenDeath(state, events);
    resolveAction(state, index, events);
  }

  if (state.phase === 'ended') return;
  state.clockMs = target;
  announceSuddenDeath(state, events);

  if (state.clockMs >= MAX_BATTLE_MS) endByTimeout(state, events);
}

function announceSuddenDeath(state, events) {
  if (state.suddenDeathAnnounced || state.clockMs < SUDDEN_DEATH_START_MS) return;
  state.suddenDeathAnnounced = true;
  events.push({
    t: state.clockMs,
    type: 'suddenDeath',
    multiplier: suddenDeathMultiplier(state.clockMs),
  });
}

function resolveAction(state, index, events) {
  const attacker = state.fighters[index];
  const defender = state.fighters[1 - index];

  // Burn bites at the start of the burning robot's own action.
  const burn = burnDamage(attacker.statuses, attacker.maxHp);
  if (burn > 0) {
    applyDamage(state, index, burn, 'burn', events);
    if (state.phase === 'ended') return;
  }

  const choice = chooseAction(state.rng, {
    posture: attacker.posture,
    hpFraction: attacker.hp / attacker.maxHp,
    surgeCharges: attacker.surge,
    element: attacker.element,
    statuses: attacker.statuses,
  });
  state.rng = choice.state;
  const action = choice.value;

  attacker.actionsTaken += 1;

  if (action === 'guard') {
    attacker.surge += 1;
    events.push({ t: state.clockMs, type: 'action', fighter: index, action: 'guard' });
    events.push({ t: state.clockMs, type: 'surge', fighter: index, charges: attacker.surge });
    finishAction(state, index, events);
    return;
  }

  // "heavy" is a telegraphed overload. Task 10 turns the telegraph into a Read event;
  // until then it resolves directly, and the wind-up leaves the attacker open — the
  // defender banks a surge charge for reading it.
  const isHeavy = action === 'heavy';
  const isSurge = action === 'surge';
  const actionMult = isHeavy ? ACTION_MULT.overload : isSurge ? ACTION_MULT.surge : ACTION_MULT.strike;

  if (isSurge) {
    attacker.surge = Math.max(0, attacker.surge - SURGE_CHARGES_REQUIRED);
  }
  if (isHeavy) {
    defender.surge += 1;
  }

  const roll = rollDamage(state.rng, {
    atk: attacker.combat.atk,
    def: effectiveDefense(defender.statuses, defender.combat.def),
    actionMult,
    momentum: attacker.momentum,
    elapsedMs: state.clockMs,
  });
  state.rng = roll.state;

  // Gust: one chance to evade, consumed whether or not it fires.
  let damage = roll.value;
  let evaded = false;
  if (hasStatus(defender.statuses, 'gust')) {
    const evadeRoll = nextRandom(state.rng);
    state.rng = evadeRoll.state;
    evaded = evadeRoll.value < GUST_EVADE_CHANCE;
    defender.statuses = consumeStatus(defender.statuses, 'gust');
    if (evaded) damage = 0;
  }

  events.push({
    t: state.clockMs,
    type: 'action',
    fighter: index,
    action: isHeavy ? 'overload' : action,
    evaded,
  });

  if (damage > 0) {
    applyDamage(state, 1 - index, damage, 'action', events);
    if (state.phase === 'ended') return;
  }

  if (isSurge) {
    const result = applyElementStatus(defender.statuses, attacker.element);
    defender.statuses = result.statuses;
    if (result.applied) {
      events.push({
        t: state.clockMs,
        type: 'status',
        fighter: 1 - index,
        id: result.applied.id,
        applied: true,
      });
      if (result.applied.id === 'drench') {
        defender.surge = Math.max(0, defender.surge - DRENCH_CHARGE_LOSS);
        events.push({ t: state.clockMs, type: 'surge', fighter: 1 - index, charges: defender.surge });
      }
    }
  }

  finishAction(state, index, events);
}

/** Statuses on the acting robot count down on its own actions, then the gauge resets. */
function finishAction(state, index, events) {
  const attacker = state.fighters[index];
  const before = attacker.statuses.map((s) => s.id);
  attacker.statuses = tickStatuses(attacker.statuses);
  for (const id of before) {
    if (!attacker.statuses.some((s) => s.id === id)) {
      events.push({ t: state.clockMs, type: 'status', fighter: index, id, applied: false });
    }
  }

  const schedule = scheduleNextAction(state.rng, state.clockMs);
  attacker.nextActionAt = schedule.value;
  state.rng = schedule.state;
  state.actionCount += 1;
}

function applyDamage(state, index, amount, source, events) {
  const victim = state.fighters[index];
  const dealt = Math.min(amount, victim.hp);
  victim.hp = Math.max(0, victim.hp - amount);

  events.push({
    t: state.clockMs,
    type: 'damage',
    fighter: index,
    amount: dealt,
    hpAfter: victim.hp,
    source,
  });

  // Taking a heavy blow banks a surge charge for the victim.
  if (source === 'action' && dealt >= victim.maxHp * BIG_HIT_FRACTION && victim.hp > 0) {
    victim.surge += 1;
    events.push({ t: state.clockMs, type: 'surge', fighter: index, charges: victim.surge });
  }

  if (victim.hp <= 0) {
    state.phase = 'ended';
    state.winner = 1 - index;
    state.endReason = 'ko';
    events.push({
      t: state.clockMs,
      type: 'ko',
      winner: state.winner,
      loser: index,
      endReason: 'ko',
    });
  }
}

/** The hard ceiling. Highest HP fraction wins; an exact tie goes to the higher CI, then to A. */
function endByTimeout(state, events) {
  const [a, b] = state.fighters;
  const fractionA = a.hp / a.maxHp;
  const fractionB = b.hp / b.maxHp;
  let winner = 0;
  if (fractionB > fractionA) winner = 1;
  else if (fractionB === fractionA && b.ci > a.ci) winner = 1;

  state.phase = 'ended';
  state.winner = winner;
  state.endReason = 'timeout';
  events.push({
    t: state.clockMs,
    type: 'ko',
    winner,
    loser: 1 - winner,
    endReason: 'timeout',
  });
}
