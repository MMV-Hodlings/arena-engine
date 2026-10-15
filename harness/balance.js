/**
 * Pairwise balance harness. Not a test: a tool. Runs every robot in the roster against
 * every other across many seeds, at matched and mismatched skill, and prints the win rate
 * against the CI gap so you can see whether the numbers in constants.js produce the game
 * the spec describes.
 *
 *   node harness/balance.js --seeds 20 --roster harness/roster.sample.json
 */

import { readFileSync } from 'node:fs';
import { createBattle, step } from '../src/battle.js';
import { toFighter, combatIndex, deriveCombat } from '../src/stats.js';
import { hitsToKill } from '../src/damage.js';
import { planClashInputs } from '../src/ai.js';
import { hashSeed } from '../src/rng.js';
import { MAX_TICK_STEP_MS } from '../src/constants.js';

/**
 * How much stronger A is than B, as the ratio of hits each needs to finish the other.
 *
 * This is NOT the Combat Index. CI sums the three stars flat, but attack enters the damage
 * formula quadratically (ATK x ATK/(ATK+DEF)) while HP is linear, so two robots with
 * identical CI are not evenly matched: measured here, a 4/2/2 build beats a 2/2/4 build of
 * the same CI about 85% of the time. Matchmaking that pairs on raw CI would therefore
 * produce lopsided fights, which is why this harness buckets on the ratio below.
 */
function powerRatio(a, b) {
  const ca = deriveCombat(a, b.element);
  const cb = deriveCombat(b, a.element);
  const hitsA = hitsToKill({ atk: ca.atk, def: cb.def, hp: cb.hp });
  const hitsB = hitsToKill({ atk: cb.atk, def: ca.def, hp: ca.hp });
  return hitsB / hitsA;
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const seeds = Number(arg('seeds', 10));
const rosterPath = arg('roster', 'harness/roster.sample.json');
const roster = JSON.parse(readFileSync(rosterPath, 'utf8'));

/** Runs one battle with both sides played by the AI at the given competences. */
function simulate(seed, a, b, competenceA, competenceB) {
  let state = createBattle({ seed, a, b });
  let rng = hashSeed(`${seed}-ai`);
  let now = 0;
  let planned = null;

  for (let i = 0; i < 20_000 && state.phase !== 'ended'; i++) {
    if (state.phase === 'clash' && !planned) {
      const forA = planClashInputs(state.clash, 'a', { competence: competenceA }, rng);
      rng = forA.state;
      const forB = planClashInputs(state.clash, 'b', { competence: competenceB }, rng);
      rng = forB.state;
      planned = [...forA.value, ...forB.value];
      for (const input of planned) {
        state = step(state, { type: 'clashInput', ...input }).state;
      }
    }
    if (state.phase !== 'clash') planned = null;

    now += MAX_TICK_STEP_MS;
    state = step(state, { type: 'tick', toMs: now }).state;
  }
  return state;
}

const buckets = new Map();
let battles = 0;
let totalMs = 0;
let matchmadeBattles = 0;
let matchmadeMs = 0;
let closest = null;

for (let i = 0; i < roster.length; i++) {
  for (let j = i + 1; j < roster.length; j++) {
    const a = toFighter(roster[i]);
    const b = toFighter(roster[j]);
    const ratio = powerRatio(a, b);
    const spread = Math.max(ratio, 1 / ratio);
    const bucket = spread < 1.15 ? 'even' : spread < 1.6 ? 'slight' : spread < 3 ? 'clear' : 'crushing';
    const favourite = ratio >= 1 ? 0 : 1;

    if (!closest || spread < closest.spread) closest = { a, b, spread, i, j };

    for (let s = 0; s < seeds; s++) {
      const state = simulate(`${i}-${j}-${s}`, a, b, 0.5, 0.5);
      const row = buckets.get(bucket) ?? { battles: 0, favouriteWins: 0, ms: 0, ciSpread: 0 };
      row.battles++;
      row.ms += state.clockMs;
      row.ciSpread += Math.max(combatIndex(a) / combatIndex(b), combatIndex(b) / combatIndex(a));
      if (state.winner === favourite) row.favouriteWins++;
      buckets.set(bucket, row);
      battles++;
      totalMs += state.clockMs;
      if (bucket === 'even' || bucket === 'slight') {
        matchmadeBattles++;
        matchmadeMs += state.clockMs;
      }
    }
  }
}

console.log(`\n${battles} battles, mean length ${(totalMs / battles / 1000).toFixed(1)}s`);
console.log(
  `matchmade range only (even + slight): ${matchmadeBattles} battles, mean length ` +
    `${matchmadeBattles ? (matchmadeMs / matchmadeBattles / 1000).toFixed(1) : '-'}s\n`,
);
console.log('power gap  battles   stronger robot wins   mean length   mean CI gap');
for (const name of ['even', 'slight', 'clear', 'crushing']) {
  const row = buckets.get(name);
  if (!row) continue;
  const rate = ((row.favouriteWins / row.battles) * 100).toFixed(1);
  console.log(
    `${name.padEnd(10)} ${String(row.battles).padEnd(9)} ${`${rate}%`.padEnd(21)} ` +
      `${`${(row.ms / row.battles / 1000).toFixed(1)}s`.padEnd(13)} ${(row.ciSpread / row.battles).toFixed(2)}x`,
  );
}

console.log(
  `\nSkill sweep on the most evenly matched pair (roster ${closest.i} vs ${closest.j}, ` +
    `power gap ${closest.spread.toFixed(3)}x) — competence of A against B at 0.5:`,
);
const a0 = closest.a;
const b0 = closest.b;
for (const competence of [0, 0.25, 0.5, 0.75, 1]) {
  let wins = 0;
  for (let s = 0; s < seeds * 10; s++) {
    if (simulate(`sweep-${competence}-${s}`, a0, b0, competence, 0.5).winner === 0) wins++;
  }
  console.log(`  competence ${competence}: ${((wins / (seeds * 10)) * 100).toFixed(1)}% wins`);
}
