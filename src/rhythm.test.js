/**
 * The battle pacing design (2026-10-19): which events a battle draws, how often, and the rhythm
 * of the actions between them. These play whole battles with the practice AI on both seats, so
 * they test the rules as a player meets them rather than one function at a time.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createBattle, step } from './battle.js';
import { toFighter } from './stats.js';
import { planClashInputs } from './ai.js';
import { hashSeed } from './rng.js';
import { CLASH_WEIGHTS } from './events/index.js';
import { OPTIMAL_STANCE_MIX } from './actions.js';
import { MAX_TICK_STEP_MS, ACTION_CADENCE_MS, MIN_BLOW_GAP_MS, CLASH_CHANCE_RAMP, OMEN_MS } from './constants.js';

const roster = JSON.parse(readFileSync(new URL('../harness/roster.sample.json', import.meta.url), 'utf8'));
const robot = (i, posture) => ({ ...toFighter(roster[i % roster.length]), posture });

/** A whole battle, both seats' clash inputs planned by the AI at competence 0.5 the moment a window appears. */
function play(seed, a, b) {
  let state = createBattle({ seed, a, b });
  let rng = hashSeed(`${seed}-ai`);
  let planned = null;
  const events = [];
  for (let now = MAX_TICK_STEP_MS; state.phase !== 'ended' && now < 2_000_000; now += MAX_TICK_STEP_MS) {
    if (state.phase === 'clash' && planned !== state.clash.startedAt) {
      planned = state.clash.startedAt;
      for (const seat of ['a', 'b']) {
        const plan = planClashInputs(state.clash, seat, { competence: 0.5 }, rng);
        rng = plan.state;
        for (const input of plan.value) state = step(state, { type: 'clashInput', ...input }).state;
      }
    }
    const out = step(state, { type: 'tick', toMs: now });
    state = out.state;
    events.push(...out.events);
  }
  return { state, events };
}

test('every event is drawn at the same weight except Power Routing, at three quarters', () => {
  assert.deepEqual({ ...CLASH_WEIGHTS }, {
    read: 2, tugOfWar: 2, overloadSurge: 2, reflexStrike: 2, targetingLock: 2, sequenceLock: 2, powerRouting: 1.5,
  });
});

test('the rhythm is the one the design fixed', () => {
  assert.equal(ACTION_CADENCE_MS, 6000);
  assert.equal(MIN_BLOW_GAP_MS, 2000);
  assert.deepEqual([...CLASH_CHANCE_RAMP], [0.3, 0.6, 1]);
  // The owner's call, 2026-10-19: a 3s hint, then a 5s briefing before a timing event's input opens.
  assert.equal(OMEN_MS, 3000);
});

test('a heavy swing settles at once as an exchange, and never telegraphs', () => {
  let heavies = 0;
  for (let i = 0; i < 40; i++) {
    const { events } = play(`heavy-${i}`, robot(i, 'aggressive'), robot(i, 'aggressive'));
    assert.equal(events.filter((e) => e.type === 'action' && e.action === 'telegraph').length, 0);
    events.forEach((e, k) => {
      if (e.type !== 'action' || e.action !== 'heavy') return;
      heavies += 1;
      // Settled in the same moment, and the swing shows with the exchange line that tells it.
      const exchange = events.slice(k + 1).find((x) => x.type === 'exchange');
      assert.equal(exchange.t, e.t);
      assert.equal(exchange.source, 'heavy');
      assert.equal(exchange.by, e.fighter);
      assert.equal(exchange.stances[e.fighter === 0 ? 'a' : 'b'], 'overload');
    });
  }
  assert.ok(heavies > 100, `only ${heavies} heavy swings`);
});

test('the answer to a heavy swing follows the optimal stance mix', () => {
  const replies = { strike: 0, guard: 0, overload: 0 };
  for (let i = 0; i < 150; i++) {
    for (const e of play(`reply-${i}`, robot(i, 'aggressive'), robot(i, 'aggressive')).events) {
      if (e.type === 'exchange' && e.source === 'heavy') replies[e.stances[e.by === 0 ? 'b' : 'a']] += 1;
    }
  }
  const total = replies.strike + replies.guard + replies.overload;
  assert.ok(total > 0, 'no heavy swing was ever answered');
  for (const [stance, share] of OPTIMAL_STANCE_MIX) {
    assert.ok(Math.abs(replies[stance] / total - share) < 0.05, `${stance} answered ${(replies[stance] / total).toFixed(3)}`);
  }
});

test('a Read names the robot whose action drew it', () => {
  let reads = 0;
  for (let i = 0; i < 60; i++) {
    const { events } = play(`drawn-${i}`, robot(i, 'balanced'), robot(i, 'balanced'));
    events.forEach((e, k) => {
      if (e.type !== 'clashStart' || e.id !== 'read') return;
      reads += 1;
      const trigger = events.slice(0, k).reverse().find((x) => x.type === 'action');
      assert.equal(e.public.heavyBy, trigger.fighter);
    });
  }
  assert.ok(reads > 20, `only ${reads} Reads in sixty battles`);
});

test('never more than three actions pass without an event', () => {
  for (let i = 0; i < 60; i++) {
    let since = 0;
    for (const e of play(`ramp-${i}`, robot(i, 'defensive'), robot(i, 'defensive')).events) {
      if (e.type === 'action') since += 1;
      if (e.type === 'clashStart') assert.ok(since <= 3, `ramp-${i}: ${since} actions before an event`);
      if (e.type === 'clashEnd') since = 0;
    }
  }
});

test('two actions are never closer together than MIN_BLOW_GAP_MS', () => {
  for (let i = 0; i < 40; i++) {
    const actions = play(`gap-${i}`, robot(i, 'balanced'), robot(i, 'balanced')).events.filter((e) => e.type === 'action');
    for (let k = 1; k < actions.length; k++) {
      assert.ok(actions[k].t - actions[k - 1].t >= MIN_BLOW_GAP_MS - 1e-6, `gap-${i}: ${actions[k].t - actions[k - 1].t}ms`);
    }
  }
});

test('posture balance holds: the same robot in two postures wins between 35% and 65% of the time', () => {
  for (const [p, q] of [['aggressive', 'balanced'], ['aggressive', 'defensive'], ['balanced', 'defensive']]) {
    let wins = 0;
    let n = 0;
    for (let i = 0; i < roster.length; i++) {
      for (let s = 0; s < 8; s++) {
        const swap = s % 2 === 1;
        const { state } = play(`posture-${p}-${q}-${i}-${s}`, swap ? robot(i, q) : robot(i, p), swap ? robot(i, p) : robot(i, q));
        n += 1;
        if (state.winner === (swap ? 1 : 0)) wins += 1;
      }
    }
    assert.ok(wins / n > 0.35 && wins / n < 0.65, `${p} beat ${q} ${((100 * wins) / n).toFixed(1)}% of ${n}`);
  }
});
