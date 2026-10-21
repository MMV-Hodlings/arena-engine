// A guard on a robot's own turn (owner's call, 2026-10-21): besides its Surge charge, it doubles the
// robot's defence against the next strike or surge that hits it, until that hit lands or the robot
// acts again. Heavy swings, Reads and Tug of War's extra hit have their own rules and ignore it.
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createBattle, step } from './battle.js';
import { toFighter } from './stats.js';
import { GUARD_DEFENSE_MULT, MAX_TICK_STEP_MS } from './constants.js';

const roster = JSON.parse(readFileSync(new URL('../harness/roster.sample.json', import.meta.url), 'utf8'));
const robot = { ...toFighter(roster[2]), posture: 'aggressive' };

/** Ticks until the first action of the fight resolves; returns the state and that action's events. */
function firstAction(state) {
  const events = [];
  for (let now = state.clockMs + MAX_TICK_STEP_MS; now < 60_000; now += MAX_TICK_STEP_MS) {
    const out = step(state, { type: 'tick', toMs: now });
    state = out.state;
    events.push(...out.events);
    if (events.some((e) => e.type === 'action')) {
      // Let the beats release the rest of the action's moment.
      for (let more = now + MAX_TICK_STEP_MS; more < now + 4000; more += MAX_TICK_STEP_MS) {
        const rest = step(state, { type: 'tick', toMs: more });
        state = rest.state;
        events.push(...rest.events.filter((e) => e.type === 'damage' || e.type === 'action'));
        if (rest.events.some((e) => e.type === 'action')) break;
      }
      return { state, action: events.find((e) => e.type === 'action'), events };
    }
  }
  throw new Error('no action');
}

/** A battle stopped just before its first action, and which robot acts first with what. */
function beforeFirstStrike() {
  for (let n = 0; n < 200; n++) {
    let state = createBattle({ seed: `guard-${n}`, a: robot, b: robot });
    const { action } = firstAction(state);
    if (action.action !== 'strike' || action.evaded) continue;
    return { state, attacker: action.fighter, target: 1 - action.fighter };
  }
  throw new Error('no battle opened on a strike');
}

const guardOn = (state, index) => ({ ...state, fighters: state.fighters.map((f, i) => (i === index ? { ...f, guarded: true } : f)) });

test('a guard doubles defence against the strike that follows it', () => {
  assert.equal(GUARD_DEFENSE_MULT, 2);
  const { state, attacker, target } = beforeFirstStrike();
  const plain = firstAction(state).action.amount;
  const guarded = firstAction(guardOn(state, target)).action.amount;
  const { atk } = state.fighters[attacker].combat;
  const { def } = state.fighters[target].combat;
  // Damage runs as atk² / (atk + def), so doubling defence scales it by (atk + def) / (atk + 2·def).
  assert.ok(Math.abs(guarded / plain - (atk + def) / (atk + 2 * def)) < 1e-9, `${guarded} against ${plain}`);
  assert.ok(guarded < plain);
});

test('the guard is spent by the hit it softened', () => {
  const { state, target } = beforeFirstStrike();
  const after = firstAction(guardOn(state, target)).state;
  assert.equal(!!after.fighters[target].guarded, false);
});

test('a guard lapses when its robot acts again, unless it guards again', () => {
  const { state, attacker } = beforeFirstStrike();
  // The robot about to strike was guarding: its own action ends that.
  const after = firstAction(guardOn(state, attacker)).state;
  assert.equal(!!after.fighters[attacker].guarded, false);
});

test('a guard on a robot’s turn leaves it guarded', () => {
  for (let n = 0; n < 200; n++) {
    const state = createBattle({ seed: `guard-turn-${n}`, a: { ...robot, posture: 'defensive' }, b: { ...robot, posture: 'defensive' } });
    const { state: after, action } = firstAction(state);
    if (action.action !== 'guard') continue;
    assert.equal(after.fighters[action.fighter].guarded, true);
    return;
  }
  assert.fail('no battle opened on a guard');
});
