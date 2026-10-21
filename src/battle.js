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
 * Phases: intro -> fighting -> ended. Between actions an event runs as 'omen' (a hint, the fight
 * paused) then 'clash' (an optional briefing, then the input window), and the fight resumes.
 */

import { hashSeed, nextRandom } from './rng.js';
import { deriveCombat, combatIndex } from './stats.js';
import { rollDamage } from './damage.js';
import { statusForElement } from './elements.js';
import { isFeedLine, spaceMoment } from './beats.js';
import { hitMoments } from './moments.js';
import { MOMENTUM_START } from './momentum.js';
import {
  applyElementStatus, tickStatuses, hasStatus, consumeStatus,
  effectiveDefense, burnDamage, GUST_EVADE_CHANCE, DRENCH_CHARGE_LOSS,
} from './status.js';
import { ACTION_MULT, chooseAction, resolveStances, OPTIMAL_STANCE_MIX } from './actions.js';
import { scheduleNextAction, dueFighters } from './timeline.js';
import { applyClashScores } from './momentum.js';
import { weightedPick } from './rng.js';
import { CLASH_EVENTS, CLASH_WEIGHTS } from './events/index.js';
import {
  ENGINE_VERSION, INTRO_MS, MAX_TICK_STEP_MS, MAX_BATTLE_MS,
  SURGE_CHARGES_REQUIRED, BIG_HIT_FRACTION, OMEN_MS, LINE_BEAT_MS,
  CLASH_CHANCE_RAMP, MIN_BLOW_GAP_MS, LOW_HP_FRACTION, REPEAT_WEIGHT_FACTOR,
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
    // Damaging hits in a row without taking damage in between, for narration's streak moment.
    streak: 0,
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
    // Actions by either robot since the last clash event closed: what the rising chance reads.
    actionsSinceClash: 0,
    firstBloodDone: false,
    // Whether any damage at all has landed yet: the first hit that deals some is first blood.
    blooded: false,
    reelingClashDone: false,
    // The last event drawn, made less likely next (REPEAT_WEIGHT_FACTOR).
    lastClashId: null,
    omen: null,
    clash: null,
    // Events resolved but not yet released: the feed's beats (beats.js), and when its last line lands.
    queue: [],
    lastLineAt: null,
    lastBlowAt: null,
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
  // A decision event closes the moment both players have committed; the next tick resolves it.
  if (event.settled?.(next.clash.eventState)) next.clash.endsAt = atMs;
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
    omen: state.omen ? { ...state.omen } : null,
    clash: state.clash ? { ...state.clash } : null,
    queue: state.queue ? [...state.queue] : [],
  };
}

function advanceTo(state, target, events) {
  state.queue ??= [];
  // The battle is decided and only its last lines are left: release them, then end.
  if (state.phase === 'finishing') {
    const last = state.queue.at(-1)?.t ?? target;
    release(state, target, events);
    if (state.queue.length > 0) {
      state.clockMs = target;
      return;
    }
    // It ends on its K.O. line, not on whichever tick reached it, so a replay ticked on another
    // grid ends at the same moment.
    state.clockMs = last;
    state.phase = 'ended';
    return;
  }
  run(state, target);
  release(state, target, events);
  // A battle decided with lines still to come keeps running until they are out (see beats.js).
  if (state.phase === 'ended' && state.queue.length > 0) state.phase = 'finishing';
}

/** Releases every queued event due by `upTo`, in order. */
function release(state, upTo, out) {
  while (state.queue.length > 0 && state.queue[0].t <= upTo) out.push(state.queue.shift());
}

/**
 * One moment of the fight: whatever `resolve` produces at the current battle time, spread into
 * beats (beats.js) and queued for release. Nothing else may happen until the moment's last line has
 * had its beat: the next action waits, and a hint's event opens a hint's length after the hint.
 */
function moment(state, resolve) {
  const raw = [];
  resolve(raw);
  if (raw.length === 0) return;
  const fighters = state.fighters;
  const hasLine = raw.some((event) => isFeedLine(event, fighters));
  const base = hasLine && state.lastLineAt != null ? Math.max(state.clockMs, state.lastLineAt + LINE_BEAT_MS) : state.clockMs;
  const spaced = spaceMoment(raw, base, fighters);
  for (const event of spaced) {
    if (isFeedLine(event, fighters)) state.lastLineAt = event.t;
    if (event.type === 'action') state.lastBlowAt = event.t;
  }
  state.queue.push(...spaced);
  state.queue.sort((x, y) => x.t - y.t);

  const omen = spaced.find((event) => event.type === 'omen');
  if (omen && state.omen) {
    state.omen.hintAt = omen.t;
    state.omen.opensAt = omen.t + OMEN_MS;
  }
  // Blows stay MIN_BLOW_GAP_MS apart as the feed shows them, not only as they resolve: a blow whose
  // line waited behind another (a Burn tick before it) holds the next one back by as much.
  if (state.phase === 'fighting' && state.lastLineAt != null) {
    const earliest = Math.max(state.lastLineAt + LINE_BEAT_MS, (state.lastBlowAt ?? -Infinity) + MIN_BLOW_GAP_MS);
    for (const fighter of state.fighters) fighter.nextActionAt = Math.max(fighter.nextActionAt, earliest);
  }
}

function run(state, target) {
  // The omen: a hint holds the stage, the fight paused, until its event opens.
  if (state.phase === 'omen') {
    if (target < state.omen.opensAt) {
      state.clockMs = target;
      return;
    }
    state.clockMs = state.omen.opensAt;
    moment(state, (events) => openClash(state, events));
  }

  // Bullet time: the fight is frozen until the event's window closes.
  if (state.phase === 'clash') {
    const clash = state.clash;
    if (target < clash.endsAt) {
      state.clockMs = target;
      return;
    }
    state.clockMs = clash.endsAt;
    moment(state, (events) => resolveClash(state, events));
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
    moment(state, (events) => events.push({ t: state.clockMs, type: 'fightStart' }));
  }

  // Resolve every action whose gauge filled inside this slice, in time order.
  for (let guard = 0; guard < 16; guard++) {
    if (state.phase !== 'fighting') return;
    const due = dueFighters(state.fighters, target);
    if (due.length === 0) break;
    const index = due[0];
    state.clockMs = Math.max(state.clockMs, state.fighters[index].nextActionAt);
    moment(state, (events) => resolveAction(state, index, events));
  }

  if (state.phase !== 'fighting') return;
  state.clockMs = target;

  if (state.clockMs >= MAX_BATTLE_MS) moment(state, (events) => endByTimeout(state, events));
}

/**
 * An event has been drawn: its hint takes the stage for OMEN_MS before it opens, and the fight
 * is paused from here until the event closes. `fighter` is the robot whose action drew it.
 */
function beginOmen(state, id, fighter, events) {
  if (!state.registry.events[id]) return;
  state.omen = { id, fighter, startedAt: state.clockMs, opensAt: state.clockMs + OMEN_MS };
  state.lastClashId = id;
  state.phase = 'omen';
  events.push({ t: state.clockMs, type: 'omen', id, fighter });
}

/**
 * Opens the event the omen foreshadowed. A briefed event announces itself now and opens input
 * `briefingMs` later; event modules measure time from `startedAt`, when input opens, so none of
 * their geometry knows the briefing exists.
 */
function openClash(state, events) {
  const omen = state.omen;
  const event = state.registry.events[omen.id];
  const init = event.init(state.rng, { heavyBy: omen.fighter });
  state.rng = init.state;
  const announcedAt = state.clockMs;
  const startedAt = announcedAt + (event.briefingMs ?? 0);
  state.clash = {
    id: omen.id,
    eventState: init.value,
    pausedFrom: omen.startedAt,
    announcedAt,
    startedAt,
    endsAt: startedAt + event.durationMs,
  };
  state.omen = null;
  state.phase = 'clash';
  events.push({
    t: announcedAt,
    type: 'clashStart',
    id: omen.id,
    announcedAt,
    startedAt,
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

  // The verdict in words follows the result card a beat later (beats.js), and the event's effect a
  // beat after that.
  events.push({ t: state.clockMs, type: 'clashVerdict', id: clash.id, scores });

  state.phase = 'fighting';
  // The fight was paused from the omen to the close, briefing included.
  const pausedFor = clash.endsAt - (clash.pausedFrom ?? clash.startedAt);
  state.clash = null;
  // Push both gauges back by the frozen time so the resume is not a burst.
  for (const fighter of state.fighters) {
    fighter.nextActionAt = Math.max(fighter.nextActionAt + pausedFor, state.clockMs + 1);
  }

  state.actionsSinceClash = 0;

  if (outcome.exchange) {
    runExchange(state, outcome.exchange, events, { source: 'read', by: clash.eventState?.heavyBy ?? 0 });
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

/**
 * Two committed stances resolve into one simultaneous exchange: a Read's, or a heavy swing's,
 * where the swinger overloads and the target answers from the optimal mix. `source` and `by`
 * (the robot that wound up) travel on the event so narration can tell the two apart.
 */
function runExchange(state, exchange, events, { source, by }) {
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
    });
    state.rng = roll.state;
    hits.push({ target: 1 - index, amount: roll.value });
  }
  // No draws (owner's call, 2026-10-21): when both hits would knock their robots out, the exchange's
  // winner is spared on 1 HP and only the loser falls. A tie by stance is settled the way the time
  // limit settles one: the robot with more of its health left, then the higher Combat Index.
  if (hits.length === 2 && hits.every((hit) => hit.amount >= state.fighters[hit.target].hp)) {
    const survivor = resolved.outcome === 'a' ? 0 : resolved.outcome === 'b' ? 1 : standingLeader(state);
    const spared = hits.find((hit) => hit.target === survivor);
    spared.amount = Math.max(0, state.fighters[survivor].hp - 1);
  }

  // Each hit's part in the story, worked out before any of them lands: what it dealt and the
  // moments it made. When both robots hit each other, neither is on a run.
  const mutual = hits.length === 2 && hits.every((hit) => hit.amount > 0);
  let blooded = state.blooded;
  const told = hits.map((hit) => {
    const target = state.fighters[hit.target];
    const attacker = state.fighters[1 - hit.target];
    const dealt = Math.min(hit.amount, target.hp);
    const streak = mutual || !(dealt > 0) ? 0 : (attacker.streak ?? 0) + 1;
    const moments = hitMoments({
      target,
      attacker: { hp: attacker.hp, maxHp: attacker.maxHp, streak },
      dealt,
      firstBlood: !blooded,
    });
    if (dealt > 0) blooded = true;
    return { fighter: hit.target, amount: dealt, moments };
  });
  events.push({
    t: state.clockMs,
    type: 'exchange',
    source,
    by,
    stances: exchange,
    outcome: resolved.outcome,
    hits: told,
  });
  // Simultaneous: both hits land even if one is lethal.
  for (const hit of hits) {
    if (hit.amount > 0) applyDamage(state, hit.target, hit.amount, 'exchange', events);
  }
  if (!mutual) {
    for (const hit of told) {
      if (hit.amount > 0) state.fighters[1 - hit.fighter].streak = (state.fighters[1 - hit.fighter].streak ?? 0) + 1;
    }
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
 * Spec section 4, as amended by the pacing design: a chance that rises with every action since
 * the last event closed (CLASH_CHANCE_RAMP), plus a forced event at first blood and when either
 * robot drops below a quarter HP. `index` is the robot whose action just resolved: a Read drawn
 * here is that robot winding up.
 */
function maybeStartClash(state, index, events) {
  if (state.phase !== 'fighting' || state.clash) return;

  const reeling = state.fighters.some((f) => f.hp > 0 && f.hp / f.maxHp <= LOW_HP_FRACTION);
  const firstBlood = !state.firstBloodDone && state.fighters.some((f) => f.hp < f.maxHp);
  if (firstBlood) state.firstBloodDone = true;

  const forced = firstBlood || (reeling && !state.reelingClashDone);
  if (reeling) state.reelingClashDone = true;

  const roll = nextRandom(state.rng);
  state.rng = roll.state;
  const step = Math.min(Math.max(state.actionsSinceClash, 1), CLASH_CHANCE_RAMP.length);
  if (!forced && roll.value >= CLASH_CHANCE_RAMP[step - 1]) return;

  // The event that just happened is less likely to come straight back (REPEAT_WEIGHT_FACTOR).
  const entries = Object.entries(state.registry.weights)
    .filter(([id]) => state.registry.events[id])
    .map(([id, weight]) => [id, id === state.lastClashId ? weight * REPEAT_WEIGHT_FACTOR : weight]);
  if (entries.length === 0) return;
  const picked = weightedPick(state.rng, entries);
  state.rng = picked.state;
  beginOmen(state, picked.value, index, events);
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

  // A heavy swing settles at once through the stance triangle: the swinger overloads and the
  // target answers with a stance drawn from the optimal mix. Against that mix an overload gains
  // nothing on average, so the swing is a gamble rather than free damage. (Opening a Read on
  // every heavy swing made the Read half of all events; letting four in five land as a plain
  // 1.6x hit had aggressive robots beating defensive ones 87% of the time.)
  if (action === 'heavy') {
    const answer = weightedPick(state.rng, OPTIMAL_STANCE_MIX);
    state.rng = answer.state;
    events.push({ t: state.clockMs, type: 'action', fighter: index, action: 'heavy' });
    const stances = index === 0 ? { a: 'overload', b: answer.value } : { a: answer.value, b: 'overload' };
    runExchange(state, stances, events, { source: 'heavy', by: index });
    if (state.phase === 'ended') return;
    finishAction(state, index, events);
    return;
  }

  const isSurge = action === 'surge';
  const actionMult = isSurge ? ACTION_MULT.surge : ACTION_MULT.strike;

  // Every surge change is announced: the client is a renderer and rebuilds its meter
  // from the event stream alone, so a silent change desynchronises it for the rest of
  // the battle.
  if (isSurge) {
    attacker.surge = Math.max(0, attacker.surge - SURGE_CHARGES_REQUIRED);
    events.push({ t: state.clockMs, type: 'surge', fighter: index, charges: attacker.surge });
  }

  const buff = attacker.pendingBuff ?? {};
  const defenderBuff = defender.pendingBuff ?? {};
  const roll = rollDamage(state.rng, {
    atk: attacker.combat.atk,
    def: effectiveDefense(defender.statuses, defender.combat.def) * (defenderBuff.defMult ?? 1),
    actionMult: actionMult * (buff.atkMult ?? 1),
    momentum: attacker.momentum,
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

  // One line per blow: the blow carries what it dealt and the moments it made, so narration
  // never has to pair it with the damage event that follows.
  const dealt = Math.min(damage, defender.hp);
  const streak = dealt > 0 ? (attacker.streak ?? 0) + 1 : (attacker.streak ?? 0);
  const moments = hitMoments({
    target: defender,
    attacker: { hp: attacker.hp, maxHp: attacker.maxHp, streak },
    dealt,
    firstBlood: !state.blooded,
  });

  events.push({
    t: state.clockMs,
    type: 'action',
    fighter: index,
    action,
    evaded,
    amount: dealt,
    moments,
  });

  if (damage > 0) {
    applyDamage(state, 1 - index, damage, 'action', events);
    if (state.phase === 'ended') return;
    attacker.streak = streak;
  }

  if (isSurge) {
    // A status afflicts the target, except one marked `self` (Air's Gust), which guards the
    // surging robot instead.
    const onSelf = !!statusForElement(attacker.element)?.self;
    const holderIndex = onSelf ? index : 1 - index;
    const holder = state.fighters[holderIndex];
    const result = applyElementStatus(holder.statuses, attacker.element);
    holder.statuses = result.statuses;
    if (result.applied) {
      events.push({
        t: state.clockMs,
        type: 'status',
        fighter: holderIndex,
        id: result.applied.id,
        applied: true,
      });
      if (result.applied.id === 'drench') {
        holder.surge = Math.max(0, holder.surge - DRENCH_CHARGE_LOSS);
        events.push({ t: state.clockMs, type: 'surge', fighter: holderIndex, charges: holder.surge });
      }
    }
  }

  finishAction(state, index, events);
}

/**
 * Statuses on the acting robot count down on its own actions, then the gauge resets. The other
 * robot's next action is held at least MIN_BLOW_GAP_MS away, so two blows never land together.
 */
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
  state.actionsSinceClash += 1;

  const other = state.fighters[1 - index];
  other.nextActionAt = Math.max(other.nextActionAt, state.clockMs + MIN_BLOW_GAP_MS);

  maybeStartClash(state, index, events);
}

function applyDamage(state, index, amount, source, events) {
  const victim = state.fighters[index];
  const dealt = Math.min(amount, victim.hp);
  victim.hp = Math.max(0, victim.hp - amount);
  victim.streak = 0;
  if (dealt > 0) state.blooded = true;

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

/** Who is ahead on standing: the higher share of max HP, then the higher CI, then A. */
function standingLeader(state) {
  const [a, b] = state.fighters;
  const fractionA = a.hp / a.maxHp;
  const fractionB = b.hp / b.maxHp;
  if (fractionB > fractionA) return 1;
  if (fractionB === fractionA && b.ci > a.ci) return 1;
  return 0;
}

/** The hard ceiling. Highest HP fraction wins; an exact tie goes to the higher CI, then to A. */
function endByTimeout(state, events) {
  const winner = standingLeader(state);

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
