import test from 'node:test';
import assert from 'node:assert';
import { createBattle, step } from './battle.js';
import { toFighter } from './stats.js';
import { MAX_TICK_STEP_MS, SKILL_INFLUENCE_CAP, MOMENTUM_SHIFT } from './constants.js';

const fighter = (over = {}) =>
  toFighter(
    {
      asset_id: over.asset_id ?? '1',
      name: over.name ?? 'Bot',
      clan: 'Onerion',
      core_power: over.cp ?? 296,
      immutable_data: {
        cp: String(over.cp ?? 296),
        element: 'Neutral',
        'attack star': String(over.stars ?? 3),
        'defense star': String(over.stars ?? 3),
        'hp star': String(over.stars ?? 3),
        'pvp ready': '1',
        'modules equipped': '5',
      },
    },
    { posture: 'balanced' },
  );

/** An event that always fires and always hands A and B the scores we dictate. */
const rigged = (scores) =>
  Object.freeze({
    id: 'rigged',
    durationMs: 1000,
    momentumShift: MOMENTUM_SHIFT,
    init: (rngState) => ({ value: {}, state: rngState }),
    reduce: (eventState) => eventState,
    score: () => scores,
  });

function fight({ seed, a, b, scores }) {
  const event = rigged(scores);
  let state = createBattle({
    seed, a, b,
    clashRegistry: { events: { [event.id]: event }, weights: { [event.id]: 1 } },
  });
  let now = 0;
  for (let i = 0; i < 20_000 && state.phase !== 'ended'; i++) {
    now += MAX_TICK_STEP_MS;
    state = step(state, { type: 'tick', toMs: now }).state;
  }
  return state;
}

test('perfect play against hopeless play never exceeds the skill cap in damage terms', () => {
  // Momentum is the only channel skill flows through, so the achievable ratio of damage
  // dealt is bounded by (1 + cap) / (1 - cap). Anything above that is a leak.
  const ceiling = (1 + SKILL_INFLUENCE_CAP) / (1 - SKILL_INFLUENCE_CAP);
  const best = fight({ seed: 'cap', a: fighter(), b: fighter({ asset_id: '2' }), scores: { a: 1, b: 0 } });
  assert.ok(best.fighters[0].momentum <= 1 + SKILL_INFLUENCE_CAP + 1e-9);
  assert.ok(best.fighters[1].momentum >= 1 - SKILL_INFLUENCE_CAP - 1e-9);
  assert.ok(best.fighters[0].momentum / best.fighters[1].momentum <= ceiling + 1e-9);
});

test('a robot 60 percent stronger wins even when it is played badly against perfect play', () => {
  for (let i = 0; i < 40; i++) {
    const state = fight({
      seed: `power-${i}`,
      a: fighter({ cp: 480, stars: 3 }),
      b: fighter({ asset_id: '2', cp: 300, stars: 3 }),
      scores: { a: 0, b: 1 }, // the weaker robot plays perfectly, the stronger one not at all
    });
    assert.equal(state.winner, 0, `the weaker robot won battle ${i} on skill alone`);
  }
});

test('between evenly matched robots, skill decides', () => {
  let skilledWins = 0;
  for (let i = 0; i < 40; i++) {
    const state = fight({
      seed: `even-${i}`,
      a: fighter(),
      b: fighter({ asset_id: '2' }),
      scores: { a: 0, b: 1 },
    });
    if (state.winner === 1) skilledWins++;
  }
  assert.ok(skilledWins >= 30, `the skilled player only won ${skilledWins} of 40 mirror matches`);
});

test('equal play leaves the outcome to stats and seed alone', () => {
  const state = fight({ seed: 'neutral', a: fighter(), b: fighter({ asset_id: '2' }), scores: { a: 0.5, b: 0.5 } });
  assert.equal(state.fighters[0].momentum, 1);
  assert.equal(state.fighters[1].momentum, 1);
});

// Finding 9: the rigged registry above only exercises momentum. This runs the REAL event
// set so the cap is measured against what actually ships. The Read is excluded because
// spec section 3.7 deliberately exempts stance reads from the cap.
test('with the real event set, skill influence stays inside the cap', async () => {
  const { CLASH_EVENTS, CLASH_WEIGHTS } = await import('./events/index.js');

  const events = {};
  const weights = {};
  for (const [id, event] of Object.entries(CLASH_EVENTS)) {
    if (id === 'read') continue;
    // Keep every real side effect (bonus hits, buffs); force only the score.
    events[id] = Object.freeze({
      ...event,
      score: (eventState) => ({ ...event.score(eventState), a: 1, b: 0 }),
    });
    weights[id] = CLASH_WEIGHTS[id] ?? 1;
  }

  let perfect = 0;
  let hopeless = 0;
  for (let i = 0; i < 60; i++) {
    let state = createBattle({
      seed: `real-cap-${i}`,
      a: fighter(),
      b: fighter({ asset_id: '2' }),
      clashRegistry: { events, weights },
    });
    let now = 0;
    for (let n = 0; n < 20_000 && state.phase !== 'ended'; n++) {
      now += MAX_TICK_STEP_MS;
      const result = step(state, { type: 'tick', toMs: now });
      state = result.state;
      for (const event of result.events) {
        if (event.type !== 'damage' || event.amount <= 0) continue;
        if (event.fighter === 1) perfect += event.amount;
        else hopeless += event.amount;
      }
    }
  }

  const ratio = perfect / hopeless;
  const ceiling = (1 + SKILL_INFLUENCE_CAP) / (1 - SKILL_INFLUENCE_CAP);
  assert.ok(
    ratio <= ceiling,
    `perfect play dealt ${ratio.toFixed(3)}x the damage of hopeless play, over the ${ceiling}x cap`,
  );
});
