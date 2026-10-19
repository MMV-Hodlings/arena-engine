import test from 'node:test';
import assert from 'node:assert';
import { planClashInputs, choosePosture } from './ai.js';
import { CLASH_EVENTS } from './events/index.js';
import { hashSeed } from './rng.js';
import { resolveStances } from './actions.js';

/** Builds the clash record the reducer would hold for a given event. */
function clashFor(id, seed = 'ai') {
  const event = CLASH_EVENTS[id];
  const init = event.init(hashSeed(seed), { heavyBy: 0 });
  return { id, eventState: init.value, startedAt: 10_000, endsAt: 10_000 + event.durationMs };
}

/** Runs the planned inputs through the event and returns the resulting score. */
function scoreOf(id, inputs, clash) {
  const event = CLASH_EVENTS[id];
  let eventState = clash.eventState;
  for (const input of inputs) {
    eventState = event.reduce(eventState, { ...input, atMs: input.atMs - clash.startedAt });
  }
  return event.score(eventState);
}

test('every registered event can be played by the AI', () => {
  for (const id of Object.keys(CLASH_EVENTS)) {
    const clash = clashFor(id);
    const planned = planClashInputs(clash, 'b', { competence: 0.8 }, hashSeed(`plan-${id}`));
    assert.ok(Array.isArray(planned.value), `${id} produced no input list`);
    for (const input of planned.value) {
      assert.equal(input.player, 'b');
      assert.ok(input.atMs >= clash.startedAt && input.atMs <= clash.endsAt, `${id} planned input outside the window`);
    }
  }
});

test('a competent AI scores better than an incompetent one, on every event', () => {
  for (const id of Object.keys(CLASH_EVENTS)) {
    // powerRouting scores a flat 0.5 by design, and the Read is a simultaneous symmetric
    // guess — see the fairness test below, which proves no stance can be played "better"
    // in isolation. Neither is an execution event, so competence cannot move them.
    if (id === 'powerRouting' || id === 'read') continue;
    let good = 0;
    let bad = 0;
    for (let i = 0; i < 25; i++) {
      const clash = clashFor(id, `seed-${i}`);
      good += scoreOf(id, planClashInputs(clash, 'b', { competence: 1 }, hashSeed(`g${i}`)).value, clash).b;
      bad += scoreOf(id, planClashInputs(clash, 'b', { competence: 0 }, hashSeed(`b${i}`)).value, clash).b;
    }
    assert.ok(good > bad, `${id}: competent ${good.toFixed(2)} did not beat incompetent ${bad.toFixed(2)}`);
  }
});

test('a maximally competent AI scores near the top', () => {
  const clash = clashFor('reflexStrike');
  const planned = planClashInputs(clash, 'b', { competence: 1 }, hashSeed('perfect'));
  assert.ok(scoreOf('reflexStrike', planned.value, clash).b > 0.85);
});

test('the AI never exceeds the tap clamp across the event', () => {
  const clash = clashFor('tugOfWar');
  const planned = planClashInputs(clash, 'b', { competence: 1 }, hashSeed('taps'));
  const total = planned.value.reduce((sum, input) => sum + input.payload.taps, 0);
  const seconds = (clash.endsAt - clash.startedAt) / 1000;
  assert.ok(total / seconds <= 12 + 1e-9, `planned ${(total / seconds).toFixed(2)} taps per second`);
});

test('AI mashing competence is not quantised away', () => {
  // Every competence step must produce a materially different tap total, or the harness
  // cannot tell a good masher from a mediocre one — and two equal AIs always tie.
  const totals = [0.25, 0.5, 0.75, 1].map((competence) => {
    const clash = clashFor('tugOfWar');
    const planned = planClashInputs(clash, 'b', { competence }, hashSeed(`q-${competence}`));
    return planned.value.reduce((sum, input) => sum + input.payload.taps, 0);
  });
  for (let i = 1; i < totals.length; i++) {
    assert.ok(
      totals[i] > totals[i - 1] * 1.1,
      `competence steps produced ${totals.join(', ')} taps — not meaningfully distinct`,
    );
  }
});

test('planning is deterministic for a given rng state', () => {
  const clash = clashFor('sequenceLock');
  const first = planClashInputs(clash, 'a', { competence: 0.6 }, hashSeed('same'));
  const second = planClashInputs(clash, 'a', { competence: 0.6 }, hashSeed('same'));
  assert.deepEqual(first.value, second.value);
  assert.equal(first.state, second.state);
});

test('an unknown event id plans nothing rather than throwing', () => {
  const planned = planClashInputs({ id: 'nope', eventState: {}, startedAt: 0, endsAt: 1000 }, 'a', { competence: 1 }, hashSeed('x'));
  assert.deepEqual(planned.value, []);
});

test('posture selection returns a real posture', () => {
  const chosen = choosePosture(hashSeed('posture'), { competence: 0.5 });
  assert.ok(['aggressive', 'balanced', 'defensive'].includes(chosen.value));
});

test('the stance payoff table is pinned, skew included', () => {
  // This replaces an earlier test that summed only the MOMENTUM score (1 / 0.5 / 0) over
  // the three opposing stances. That sum is 0.5 for ANY proper rock-paper-scissors cycle,
  // so it could not fail for any payoff table — it proved nothing, and the ruling built on
  // it ("the triangle has no dominant option") was wrong.
  //
  // The Read's real effect is the damage exchange, so that is what gets measured here:
  // expected net damage per Read against an opponent picking uniformly. The current table
  // is NOT balanced — overload is the strongest pick and guard the weakest — and that skew
  // is inherited verbatim from spec section 3.7. It is pinned rather than corrected,
  // because changing it is a spec decision, and pinned rather than ignored, because the
  // numbers below are what an exploitable Read looks like.
  const stances = ['strike', 'guard', 'overload'];
  const payoff = {};
  for (const mine of stances) {
    let net = 0;
    for (const theirs of stances) {
      const resolved = resolveStances(mine, theirs);
      net += resolved.a.damageMult * resolved.b.takenMult - resolved.b.damageMult * resolved.a.takenMult;
    }
    payoff[mine] = net / stances.length;
  }

  // REBALANCED 2026-10-19, by the owner decision this test was waiting for. No stance is
  // worth more than a rounding error against uniform play now; overload used to be +0.47.
  for (const stance of stances) {
    assert.ok(Math.abs(payoff[stance]) < 0.1, `${stance} is exploitable against random play: ${payoff[stance]}`);
  }

  // The guarantee that matters: optimal play is a real mix, not one button. A stance's share
  // is proportional to the margin of the matchup it sits out of, so the margins set the meta.
  const margin = (x, y) => {
    const r = resolveStances(x, y);
    return r.a.damageMult * r.b.takenMult - r.b.damageMult * r.a.takenMult;
  };
  const share = {
    strike: margin('overload', 'guard'),
    overload: margin('guard', 'strike'),
    guard: margin('strike', 'overload'),
  };
  const total = share.strike + share.overload + share.guard;
  for (const stance of stances) {
    const pct = share[stance] / total;
    assert.ok(pct > 0.15 && pct < 0.5, `${stance} is ${(pct * 100).toFixed(0)}% of optimal play - the triangle has skewed again`);
  }

  // Overload is the gamble, so it must carry the worst single outcome of the three.
  const worst = (s) => Math.min(...stances.map((o) => margin(s, o)));
  assert.equal(
    stances.reduce((x, y) => (worst(x) <= worst(y) ? x : y)),
    'overload',
    'overload should carry the largest downside; it is the high-risk pick',
  );
});
