/**
 * The battle reducer (spec section 3.3). A pure state machine:
 *
 *     createBattle({seed, a, b}) -> state
 *     step(state, input)         -> {state, events}
 *
 * The caller owns the clock. `step` never reads the time, never rolls a number that is not
 * drawn from the seeded generator in state, and never mutates its argument. The whole state
 * is JSON-serialisable except `state.registry`, which holds the clash event modules;
 * `rehydrate(state)` reattaches them after a Durable Object restores from storage.
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
import { ACTION_MULT, chooseAction, resolveStances } from './actions.js';
import { scheduleNextAction, dueFighters } from './timeline.js';
import { applyClashScores } from './momentum.js';
import { weightedPick } from './rng.js';
import { CLASH_EVENTS, CLASH_WEIGHTS } from './events/index.js';
import { read } from './events/read.js';
import {
  ENGINE_VERSION, INTRO_MS, MAX_TICK_STEP_MS, MAX_BATTLE_MS,
  SURGE_CHARGES_REQUIRED, SUDDEN_DEATH_START_MS, BIG_HIT_FRACTION,
  CLASH_CHANCE, LOW_HP_FRACTION,
} from './constants.js';

/**
 * @param {{seed: string, a: object, b: object}} args fighters come from stats.toFighter
 * @returns {object} battle state
 */
export function createBattle({ seed, a, b, clashRegistry }) {
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
    pendingBuff: null,
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
    firstBloodDone: false,
    reelingClashDone: false,
    clash: null,
    registry: {
      events: clashRegistry?.events ?? CLASH_EVENTS,
      weights: clashRegistry?.weights ?? CLASH_WEIGHTS,
    },
  };
}

/**
 * Fails fast when a battle has been restored from storage without `rehydrate()`.
 *
 * JSON keeps the registry's shape — ids, durations, momentum shifts — and drops only the
 * functions, so a restored registry looks populated and passes a truthiness check. Without
 * this guard the battle runs normally for several seconds and then dies inside the first
 * clash event with "event.init is not a function", far from the real mistake.
 */
function assertRegistryUsable(state) {
  const events = state.registry?.events;
  if (!events) {
    throw new Error('battle state has no clash registry: call rehydrate(state) after restoring it');
  }
  for (const [id, event] of Object.entries(events)) {
    if (typeof event?.init !== 'function' || typeof event?.reduce !== 'function' || typeof event?.score !== 'function') {
      throw new Error(
        `clash event "${id}" has no behaviour: this state was restored without rehydrate(state)`,
      );
    }
  }
}

/**
 * Reattaches the non-serialisable registry after a Durable Object restores state from
 * storage. `state.registry` holds functions, so it does not survive JSON; everything else
 * does.
 * @param {object} state
 * @param {{events?: object, weights?: object}} [clashRegistry]
 * @returns {object}
 */
export function rehydrate(state, clashRegistry) {
  return {
    ...state,
    registry: {
      events: clashRegistry?.events ?? CLASH_EVENTS,
      weights: clashRegistry?.weights ?? CLASH_WEIGHTS,
    },
  };
}

/**
 * @param {object} state
 * @param {{type: string, toMs?: number, player?: 'a'|'b', payload?: object, atMs?: number}} input
 * @returns {{state: object, events: object[]}}
 *
 * CALLER CONTRACT — `input.player` is trusted absolutely.
 *
 * The engine has no notion of connections or identity, so whoever drives it MUST set
 * `player` from the authenticated socket and never from the client's message. A client
 * able to name itself could bind its opponent's Read stance before they chose, or send
 * one tap message as them with a huge `seq` and lock them out of the rest of the event.
 */
export function step(state, input) {
  if (!input) return { state, events: [] };
  if (state.phase === 'ended') return { state, events: [] };
  assertRegistryUsable(state);

  if (input.type === 'clashInput') return applyClashInput(state, input);
  if (input.type !== 'tick') return { state, events: [] };

  // A non-finite tick is rejected outright. Letting one through poisons the clock with
  // NaN, and because every later comparison against NaN is false the battle can then
  // never advance, never time out and never be resolved — with MUT staked on it.
  if (!Number.isFinite(input.toMs)) return { state, events: [] };

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

/**
 * Review Focus 3: clash input outside the open window changes nothing at all — not the
 * event state, not the clock, not the returned events.
 */
function applyClashInput(state, input) {
  const clash = state.clash;
  if (state.phase !== 'clash' || !clash) return { state, events: [] };
  if (input.player !== 'a' && input.player !== 'b') return { state, events: [] };
  const atMs = Number(input.atMs);
  if (!Number.isFinite(atMs) || atMs < clash.startedAt || atMs > clash.endsAt) {
    return { state, events: [] };
  }

  const event = state.registry.events[clash.id];
  if (!event) return { state, events: [] };

  // Events are handed time RELATIVE to the window opening, derived from the arrival time
  // the guard above validated — never a timestamp the client chose. A client that could
  // name its own press moment could claim a perfect press the instant the window opened.
  const elapsedMs = atMs - clash.startedAt;

  const next = cloneState(state);
  next.clash = {
    ...clash,
    eventState: event.reduce(clash.eventState, {
      player: input.player,
      payload: input.payload,
      atMs: elapsedMs,
    }),
  };
  return { state: next, events: [] };
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
      pendingBuff: f.pendingBuff ? { ...f.pendingBuff } : null,
    })),
    clash: state.clash ? { ...state.clash } : null,
  };
}

function advanceTo(state, target, events) {
  // Bullet time: the fight is frozen until the event's window closes.
  if (state.phase === 'clash') {
    const clash = state.clash;
    if (target < clash.endsAt) {
      state.clockMs = target;
      return;
    }
    state.clockMs = clash.endsAt;
    resolveClash(state, events);
    if (state.phase === 'ended') return;
  }

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
    if (state.phase === 'ended' || state.phase === 'clash') return;
    const due = dueFighters(state.fighters, target);
    if (due.length === 0) break;
    const index = due[0];
    state.clockMs = Math.max(state.clockMs, state.fighters[index].nextActionAt);
    announceSuddenDeath(state, events);
    resolveAction(state, index, events);
  }

  if (state.phase === 'ended' || state.phase === 'clash') return;
  state.clockMs = target;
  announceSuddenDeath(state, events);

  if (state.clockMs >= MAX_BATTLE_MS) endByTimeout(state, events);
}

/** Opens a clash event: the fight freezes until its window closes. */
function startClash(state, id, ctx, events) {
  const event = state.registry.events[id];
  if (!event) return;
  const init = event.init(state.rng, ctx);
  state.rng = init.state;
  state.clash = {
    id,
    eventState: init.value,
    startedAt: state.clockMs,
    endsAt: state.clockMs + event.durationMs,
  };
  state.phase = 'clash';
  events.push({
    t: state.clockMs,
    type: 'clashStart',
    id,
    endsAt: state.clash.endsAt,
    durationMs: event.durationMs,
    // What the client may draw. Without this the timing events are unplayable: a player
    // cannot aim at a sweet spot they were never shown.
    public: event.publicState ? event.publicState(state.clash.eventState) : {},
  });
}

/** Closes the window, applies every effect the event returned, and resumes the fight. */
function resolveClash(state, events) {
  const clash = state.clash;
  const event = state.registry.events[clash.id];
  const outcome = event.score(clash.eventState);

  // Quake halves the score of a robot that was staggered.
  const scores = {
    a: hasStatus(state.fighters[0].statuses, 'quake') ? outcome.a / 2 : outcome.a,
    b: hasStatus(state.fighters[1].statuses, 'quake') ? outcome.b / 2 : outcome.b,
  };

  const momenta = applyClashScores(
    { a: state.fighters[0].momentum, b: state.fighters[1].momentum },
    scores,
    event.momentumShift,
  );
  state.fighters[0].momentum = momenta.a;
  state.fighters[1].momentum = momenta.b;

  events.push({
    t: state.clockMs,
    type: 'clashEnd',
    id: clash.id,
    scores,
    momentum: momenta,
  });

  if (outcome.buffs) {
    applyBuff(state, 0, outcome.buffs.a, events);
    applyBuff(state, 1, outcome.buffs.b, events);
  }

  state.phase = 'fighting';
  const pausedFor = clash.endsAt - clash.startedAt;
  state.clash = null;
  // Push both gauges back by the frozen time so the resume is not a burst.
  for (const fighter of state.fighters) {
    fighter.nextActionAt = Math.max(fighter.nextActionAt + pausedFor, state.clockMs + 1);
  }

  if (outcome.exchange) {
    runExchange(state, outcome.exchange, events);
    if (state.phase === 'ended') return;
  }

  if (outcome.bonusHit) {
    const target = outcome.bonusHit.target;
    const attacker = state.fighters[1 - target];
    const defender = state.fighters[target];
    const roll = rollDamage(state.rng, {
      atk: attacker.combat.atk,
      def: effectiveDefense(defender.statuses, defender.combat.def),
      actionMult: outcome.bonusHit.mult,
      momentum: attacker.momentum,
      elapsedMs: state.clockMs,
    });
    state.rng = roll.state;
    if (roll.value > 0) applyDamage(state, target, roll.value, 'clash', events);
  }
}

function applyBuff(state, index, buff, events) {
  // An event that hands this player nothing must leave an earlier, unspent buff alone.
  // Power Routing always returns a buffs object, with {} for a player who allocated
  // nothing, so `!buff` alone would let a later event silently delete a live reward.
  if (!buff || Object.keys(buff).length === 0) return;
  const fighter = state.fighters[index];
  if (buff.surge) {
    fighter.surge += buff.surge;
    events.push({ t: state.clockMs, type: 'surge', fighter: index, charges: fighter.surge });
  }
  const carried = {};
  if (buff.atkMult) carried.atkMult = buff.atkMult;
  if (buff.defMult) carried.defMult = buff.defMult;
  if (buff.surge) carried.surge = buff.surge;
  fighter.pendingBuff = Object.keys(carried).length > 0 ? carried : null;
}

/** The Read: both committed stances resolve into one simultaneous exchange. */
function runExchange(state, exchange, events) {
  const resolved = resolveStances(exchange.a, exchange.b);
  const hits = [];
  for (const index of [0, 1]) {
    const side = index === 0 ? resolved.a : resolved.b;
    const otherSide = index === 0 ? resolved.b : resolved.a;
    if (side.damageMult === 0) continue;
    const attacker = state.fighters[index];
    const defender = state.fighters[1 - index];
    const roll = rollDamage(state.rng, {
      atk: attacker.combat.atk,
      def: effectiveDefense(defender.statuses, defender.combat.def),
      actionMult: side.damageMult * otherSide.takenMult,
      momentum: attacker.momentum,
      elapsedMs: state.clockMs,
    });
    state.rng = roll.state;
    hits.push({ target: 1 - index, amount: roll.value });
  }
  events.push({
    t: state.clockMs,
    type: 'exchange',
    stances: exchange,
    outcome: resolved.outcome,
  });
  // Simultaneous: both hits land even if one is lethal.
  for (const hit of hits) {
    if (hit.amount > 0) applyDamage(state, hit.target, hit.amount, 'exchange', events);
  }

  // Spec section 3.7: two guards deal no damage and both bank a Surge charge. Specified from
  // the start and never implemented, which left mutual guard as the one exchange where
  // nothing whatsoever happened. That was tolerable while guard was 11% of optimal play and
  // the mirror was 1% of Reads; after the 2026-10-19 rebalance guard is 39% and the mirror is
  // 15%, so the dead exchange had to go. Granting the charge is the spec's own answer and
  // makes a stand-off a decision — three of them arm an Element Surge — rather than a pause.
  // Symmetric, so it does not move the stance equilibrium.
  if (exchange.a === 'guard' && exchange.b === 'guard') {
    for (const index of [0, 1]) {
      const fighter = state.fighters[index];
      fighter.surge += 1;
      events.push({ t: state.clockMs, type: 'surge', fighter: index, charges: fighter.surge });
    }
  }
}

/**
 * Spec section 4: ~20% of action resolutions, plus a forced event at first blood and when
 * either robot drops below a quarter HP.
 */
function maybeStartClash(state, events) {
  if (state.phase !== 'fighting' || state.clash) return;

  const reeling = state.fighters.some((f) => f.hp > 0 && f.hp / f.maxHp <= LOW_HP_FRACTION);
  const firstBlood = !state.firstBloodDone && state.fighters.some((f) => f.hp < f.maxHp);
  if (firstBlood) state.firstBloodDone = true;

  const forced = firstBlood || (reeling && !state.reelingClashDone);
  if (reeling) state.reelingClashDone = true;

  const roll = nextRandom(state.rng);
  state.rng = roll.state;
  if (!forced && roll.value >= CLASH_CHANCE) return;

  const entries = Object.entries(state.registry.weights).filter(([id]) => state.registry.events[id]);
  if (entries.length === 0) return;
  const picked = weightedPick(state.rng, entries);
  state.rng = picked.state;
  startClash(state, picked.value, { heavyBy: null }, events);
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

  // A heavy swing telegraphs: it opens a Read instead of resolving directly. The
  // actionsTaken increment above already counted it, and skipClashRoll keeps
  // finishAction from starting a random event that startClash would overwrite.
  if (isHeavy && state.registry.events[read.id]) {
    events.push({ t: state.clockMs, type: 'action', fighter: index, action: 'telegraph' });
    finishAction(state, index, events, { skipClashRoll: true });
    startClash(state, read.id, { heavyBy: index }, events);
    return;
  }

  const actionMult = isHeavy ? ACTION_MULT.overload : isSurge ? ACTION_MULT.surge : ACTION_MULT.strike;

  // Every surge change is announced: the client is a renderer and rebuilds its meter
  // from the event stream alone, so a silent change desynchronises it for the rest of
  // the battle.
  if (isSurge) {
    attacker.surge = Math.max(0, attacker.surge - SURGE_CHARGES_REQUIRED);
    events.push({ t: state.clockMs, type: 'surge', fighter: index, charges: attacker.surge });
  }
  if (isHeavy) {
    defender.surge += 1;
    events.push({ t: state.clockMs, type: 'surge', fighter: 1 - index, charges: defender.surge });
  }

  const buff = attacker.pendingBuff ?? {};
  const defenderBuff = defender.pendingBuff ?? {};
  const roll = rollDamage(state.rng, {
    atk: attacker.combat.atk,
    def: effectiveDefense(defender.statuses, defender.combat.def) * (defenderBuff.defMult ?? 1),
    actionMult: actionMult * (buff.atkMult ?? 1),
    momentum: attacker.momentum,
    elapsedMs: state.clockMs,
  });
  state.rng = roll.state;
  attacker.pendingBuff = null;
  // A defensive buff is spent on the first hit it absorbs, not held until its owner acts.
  if (defenderBuff.defMult) defender.pendingBuff = null;

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
function finishAction(state, index, events, { skipClashRoll = false } = {}) {
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

  if (!skipClashRoll) maybeStartClash(state, events);
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
