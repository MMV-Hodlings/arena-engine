// The feed's beats (owner's request, 2026-10-21): every line of the fight lands on its own, a beat
// after the one before, never two at once. The engine releases them on the battle clock, so the
// feed's timestamps and the stage agree.
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createBattle, step } from './battle.js';
import { toFighter } from './stats.js';
import { planClashInputs } from './ai.js';
import { hashSeed } from './rng.js';
import { narrate } from './narration.js';
import { MAX_TICK_STEP_MS, LINE_BEAT_MS, HINT_LEAD_MS, RESULT_BEAT_MS } from './constants.js';
import { isFeedLine } from './beats.js';

const roster = JSON.parse(readFileSync(new URL('../harness/roster.sample.json', import.meta.url), 'utf8'));
const robot = (i, posture) => ({ ...toFighter(roster[i % roster.length]), posture });

function play(seed, a, b) {
  let state = createBattle({ seed, a, b });
  let rng = hashSeed(`${seed}-ai`);
  let planned = null;
  const events = [];
  const phases = [];
  for (let now = MAX_TICK_STEP_MS; state.phase !== 'ended' && now < 3_000_000; now += MAX_TICK_STEP_MS) {
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
    phases.push({ phase: state.phase, released: out.events.length });
  }
  return { state, events, phases };
}

const battles = [];
for (let i = 0; i < 60; i++) battles.push(play(`beats-${i}`, robot(i, ['aggressive', 'balanced', 'defensive'][i % 3]), robot(i + 3, 'balanced')));

const lines = (events, fighters) => events.filter((e) => isFeedLine(e, fighters));

test('no two lines of the feed land within a beat of each other', () => {
  for (const { state, events } of battles) {
    const feed = lines(events, state.fighters);
    for (let i = 1; i < feed.length; i++) {
      const gap = feed[i].t - feed[i - 1].t;
      assert.ok(gap >= LINE_BEAT_MS, `${feed[i - 1].type} then ${feed[i].type} only ${gap}ms apart`);
    }
  }
});

test('events reach the feed in time order, so the stage and the log never run backwards', () => {
  for (const { events } of battles) {
    for (let i = 1; i < events.length; i++) assert.ok(events[i].t >= events[i - 1].t, `${events[i].type} at ${events[i].t} after ${events[i - 1].t}`);
  }
});

test('a hint waits a clear lead after whatever came before it', () => {
  let seen = 0;
  for (const { state, events } of battles) {
    const feed = lines(events, state.fighters);
    feed.forEach((line, i) => {
      if (line.type !== 'omen' || i === 0) return;
      seen++;
      assert.ok(line.t - feed[i - 1].t >= HINT_LEAD_MS, `hint only ${line.t - feed[i - 1].t}ms after ${feed[i - 1].type}`);
    });
  }
  assert.ok(seen > 100);
});

test('a Read lands in three beats: the result, then who read it, then the exchange', () => {
  let seen = 0;
  for (const { events } of battles) {
    events.forEach((end, i) => {
      if (end.type !== 'clashEnd' || end.id !== 'read') return;
      const verdict = events.slice(i + 1).find((e) => e.type === 'clashVerdict');
      const exchange = events.slice(i + 1).find((e) => e.type === 'exchange');
      assert.ok(verdict && exchange);
      assert.equal(verdict.t - end.t, RESULT_BEAT_MS);
      assert.equal(exchange.t - verdict.t, RESULT_BEAT_MS);
      // The exchange's damage lands with the exchange, not with the result.
      const damage = events.slice(i + 1).filter((e) => e.type === 'damage' && e.source === 'exchange' && e.t < exchange.t);
      assert.equal(damage.length, 0);
      seen++;
    });
  }
  assert.ok(seen > 10);
});

test('every event’s verdict follows its result card a beat later, in words', () => {
  for (const { state, events } of battles) {
    events.forEach((end, i) => {
      if (end.type !== 'clashEnd') return;
      const verdict = events[i + 1]?.type === 'clashVerdict' ? events[i + 1] : events.slice(i + 1).find((e) => e.type === 'clashVerdict');
      assert.equal(verdict.t - end.t, RESULT_BEAT_MS);
      assert.ok(narrate(verdict, state.fighters));
      assert.equal(narrate(end, state.fighters), null);
    });
  }
});

test('the K.O. comes a beat after the blow that caused it, and the battle ends only then', () => {
  for (const { events, phases } of battles) {
    const ko = events.at(-1);
    assert.equal(ko.type, 'ko');
    if (ko.endReason !== 'ko') continue;
    const blow = [...events].reverse().find((e) => e.type === 'damage');
    assert.equal(ko.t - blow.t, LINE_BEAT_MS);
    // The step that released the K.O. is the one that reported the battle over.
    const ended = phases.findIndex((p) => p.phase === 'ended');
    assert.ok(phases[ended].released > 0);
    assert.ok(phases.slice(0, ended).every((p) => p.phase !== 'ended'));
  }
});

test('the beats are fixed: 1.5s between lines, 2s before a hint, 2s between an event’s result beats', () => {
  assert.equal(LINE_BEAT_MS, 1500);
  assert.equal(HINT_LEAD_MS, 2000);
  assert.equal(RESULT_BEAT_MS, 2000);
});

test('a battle ends at the same moment however it is ticked: on its K.O. line, not on the tick that reached it', () => {
  const run = (slice) => {
    let state = createBattle({ seed: 'beats-ticks', a: robot(1, 'aggressive'), b: robot(4, 'aggressive') });
    const events = [];
    for (let now = slice; state.phase !== 'ended' && now < 3_000_000; now += slice) {
      const out = step(state, { type: 'tick', toMs: now });
      state = out.state;
      events.push(...out.events);
    }
    return { state, events };
  };
  const a = run(50);
  const b = run(37);
  assert.equal(a.state.endReason, 'ko');
  assert.equal(a.state.clockMs, b.state.clockMs);
  assert.equal(a.state.clockMs, a.events.at(-1).t);
  assert.deepEqual(a.events, b.events);
});
