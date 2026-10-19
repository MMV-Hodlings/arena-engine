/**
 * Pacing report. Not a test: a tool. Checks the numbers the battle pacing design is built on
 * (docs/superpowers/specs/2026-10-19-cyber-authority-arena-battle-pacing-design.md): how many
 * events a battle holds and of which kinds, how evenly they are spread, how long battles run,
 * and whether one posture beats another.
 *
 *   npm run pacing -- --seeds 100
 *
 * Every robot in the roster fights itself, once per seed, in six pairings: the three posture
 * mirrors and the three posture pairs (seats alternating). Both seats play the clash events
 * through the practice AI at competence 0.5, planned the moment a window appears.
 *
 * Battle length is the engine clock, which includes every hint, briefing and window. The AI
 * commits a Read or a Power Routing half a second in, so those windows close far sooner than a
 * person's would: real battles run longer than this reports, by the time people spend deciding.
 */

import { readFileSync } from 'node:fs';
import { createBattle, step } from '../src/battle.js';
import { toFighter } from '../src/stats.js';
import { planClashInputs } from '../src/ai.js';
import { hashSeed } from '../src/rng.js';
import { MAX_TICK_STEP_MS } from '../src/constants.js';
import { CLASH_EVENTS } from '../src/events/index.js';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const seeds = Number(arg('seeds', 40));
const rosterPath = arg('roster', new URL('./roster.sample.json', import.meta.url));
const roster = JSON.parse(readFileSync(rosterPath, 'utf8'));
const IDS = Object.keys(CLASH_EVENTS);

function play(seed, a, b) {
  let state = createBattle({ seed, a, b });
  let rng = hashSeed(`${seed}-ai`);
  let planned = null;
  const tally = { events: Object.fromEntries(IDS.map((id) => [id, 0])), total: 0, gaps: [], since: 0 };
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
    for (const event of out.events) {
      if (event.type === 'action') tally.since += 1;
      if (event.type === 'clashStart') {
        tally.events[event.id] = (tally.events[event.id] ?? 0) + 1;
        tally.total += 1;
        tally.gaps.push(tally.since);
      }
      if (event.type === 'clashEnd') tally.since = 0;
    }
  }
  return { state, tally };
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const seconds = (ms) => `${Math.round(ms / 1000)}s`;
const robot = (i, posture) => ({ ...toFighter(roster[i]), posture });

function run(label, p, q) {
  const lengths = [];
  const byId = Object.fromEntries(IDS.map((id) => [id, 0]));
  let battles = 0;
  let events = 0;
  let gaps = 0;
  let gapSum = 0;
  let backToBack = 0;
  let firstWins = 0;
  for (let i = 0; i < roster.length; i++) {
    for (let s = 0; s < seeds; s++) {
      const swap = p !== q && s % 2 === 1;
      const { state, tally } = play(`pacing-${label}-${i}-${s}`, swap ? robot(i, q) : robot(i, p), swap ? robot(i, p) : robot(i, q));
      battles += 1;
      lengths.push(state.clockMs);
      events += tally.total;
      for (const id of IDS) byId[id] += tally.events[id] ?? 0;
      for (const gap of tally.gaps.slice(1)) {
        gaps += 1;
        gapSum += gap;
        if (gap <= 1) backToBack += 1;
      }
      if (state.winner === (swap ? 1 : 0)) firstWins += 1;
    }
  }
  lengths.sort((x, y) => x - y);
  const perBattle = IDS.map((id) => `${id} ${(byId[id] / battles).toFixed(2)}`).join(', ');
  console.log(`\n${label} (${battles} battles)`);
  console.log(`  events per battle  ${(events / battles).toFixed(1)}: ${perBattle}`);
  console.log(`  actions between    ${(gapSum / Math.max(1, gaps)).toFixed(1)} on average; ${((100 * backToBack) / Math.max(1, gaps)).toFixed(0)}% of events straight after another`);
  console.log(`  battle length      typical ${seconds(quantile(lengths, 0.5))}, 1 in 10 ${seconds(quantile(lengths, 0.9))}, longest ${seconds(lengths[lengths.length - 1])}`);
  if (p !== q) console.log(`  ${p} beats ${q}  ${((100 * firstWins) / battles).toFixed(1)}%`);
}

console.log(`Pacing report: ${roster.length} robots x ${seeds} seeds per pairing, AI at competence 0.5 on both seats.`);
for (const posture of ['aggressive', 'balanced', 'defensive']) run(`${posture} mirror`, posture, posture);
for (const [p, q] of [['aggressive', 'balanced'], ['aggressive', 'defensive'], ['balanced', 'defensive']]) run(`${p} vs ${q}`, p, q);
