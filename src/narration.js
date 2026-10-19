/**
 * Semantic events to prose (spec section 5.5, as amended by the battle pacing design).
 *
 * One line per blow: a blow's action event carries what it dealt and the moments it made, so the
 * damage event that follows it says nothing. The copy lives in narration-lines.js; this file only
 * chooses a line and appends the numbers, so every line formats them the same way.
 *
 * The phrase is chosen by hashing the event itself, not by drawing from the battle's random
 * stream. That means both clients render identical text from identical events with nothing extra
 * to synchronise, and a replay reproduces every line word for word.
 */

import { hashSeed } from './rng.js';
import { LINES } from './narration-lines.js';
import { GRAZE_FRACTION, BIG_HIT_FRACTION, ROUT_FRACTION, CLOSE_FRACTION } from './constants.js';

/** Deterministic choice from a list, keyed by the event. */
function pick(list, key) {
  return list[hashSeed(key) % list.length];
}

/** Which moment a line is about when a hit made several: the rarest and most dramatic first. */
const MOMENT_ORDER = ['comeback', 'quarter', 'streak', 'half', 'firstBlood'];

const rounded = (value) => Math.round(Number(value) || 0);

/** "sentence — 84", or the sentence alone when nothing was dealt or the amount is unknown. */
function withAmount(text, amount) {
  return rounded(amount) > 0 ? `${text} — ${rounded(amount)}` : text;
}

/** Graze, solid or crushing, by the share of the target's max HP. Unknown sizes read as solid. */
function sizeOf(amount, target) {
  const maxHp = Number(target?.maxHp);
  const dealt = Number(amount);
  if (!Number.isFinite(dealt) || !(maxHp > 0)) return 'solid';
  if (dealt >= maxHp * BIG_HIT_FRACTION) return 'crushing';
  if (dealt < maxHp * GRAZE_FRACTION) return 'graze';
  return 'solid';
}

/** Rout, clear or close, by the winner's remaining share of HP. Unknown reads as clear. */
function marginOf(winner) {
  const share = Number(winner?.hp) / Number(winner?.maxHp);
  if (!Number.isFinite(share)) return 'clear';
  if (share > ROUT_FRACTION) return 'rout';
  if (share < CLOSE_FRACTION) return 'close';
  return 'clear';
}

/** The most dramatic moment in a list, by MOMENT_ORDER, or undefined. */
function topMoment(moments) {
  return MOMENT_ORDER.find((id) => Array.isArray(moments) && moments.includes(id));
}

/**
 * A moment told as a sentence of its own, for lines that keep their own sentence first (a surge,
 * an exchange). `attacker` dealt the hit that made it, `target` took it.
 */
function momentSentence(moment, attacker, target, key) {
  return moment && attacker && target ? pick(LINES.moment[moment], `${key}:${moment}`)(attacker, target) : null;
}

function narrateBlow(event, self, other, key) {
  if (event.action === 'heavy') return null; // its exchange tells the whole swing
  if (event.evaded) return { text: pick(LINES.evaded, key)(self, other), tone: 'action' };
  if (event.action === 'guard') return { text: pick(LINES.guard, key)(self, other), tone: 'action' };
  if (event.action === 'surge') {
    const set = LINES.surge[self.element] ?? LINES.surgeAny;
    const moment = momentSentence(topMoment(event.moments), self, other, key);
    const sentence = pick(set, key)(self, other);
    return { text: withAmount(moment ? `${sentence} ${moment}` : sentence, event.amount), tone: 'crit' };
  }
  const moment = topMoment(event.moments);
  if (moment) return { text: withAmount(pick(LINES.moment[moment], key)(self, other), event.amount), tone: 'crit' };
  const size = sizeOf(event.amount, other);
  return {
    text: withAmount(pick(LINES.blow[size], key)(self, other), event.amount),
    tone: size === 'crushing' ? 'crit' : 'action',
  };
}

function narrateExchange(event, fighters, key) {
  const pair = Array.isArray(fighters) ? fighters : [];
  let sentence = null;
  if (event.source === 'heavy') {
    const by = event.by === 1 ? 1 : 0;
    const answer = event.stances?.[by === 0 ? 'b' : 'a'];
    const set = LINES.heavy[answer];
    if (set && pair[by] && pair[1 - by]) sentence = pick(set, key)(pair[by], pair[1 - by]);
  } else {
    const set = LINES.read[`${event.stances?.a}-${event.stances?.b}`];
    if (set && pair[0] && pair[1]) sentence = pick(set, key)(pair[0], pair[1]);
  }
  if (!sentence) return null;
  // A heavy swing or a Read can draw first blood, take a robot below half, and so on: the most
  // dramatic moment either hit made is told after the contest, by whoever dealt that hit.
  let best = null;
  for (const hit of Array.isArray(event.hits) ? event.hits : []) {
    const moment = topMoment(hit?.moments);
    if (moment && (!best || MOMENT_ORDER.indexOf(moment) < MOMENT_ORDER.indexOf(best.moment))) best = { moment, hit };
  }
  if (best) {
    const told = momentSentence(best.moment, pair[1 - best.hit.fighter], pair[best.hit.fighter], key);
    if (told) sentence = `${sentence} ${told}`;
  }
  const hits = (Array.isArray(event.hits) ? event.hits : [])
    .filter((hit) => rounded(hit.amount) > 0)
    .map((hit) => `${rounded(hit.amount)} to ${pair[hit.fighter]?.name ?? 'its target'}`);
  return { text: hits.length > 0 ? `${sentence} — ${hits.join(', ')}` : sentence, tone: 'crit' };
}

/**
 * @param {object} event an event emitted by battle.step
 * @param {Array<object>} fighters state.fighters
 * @returns {{text: string, tone: string} | null}
 */
export function narrate(event, fighters) {
  if (!event || typeof event.type !== 'string') return null;
  const self = fighters?.[event.fighter];
  const other = fighters?.[1 - event.fighter];
  const key = `${event.type}:${event.t}:${event.fighter ?? ''}:${event.action ?? event.id ?? ''}`;

  switch (event.type) {
    case 'fightStart':
      return { text: 'The arena goes live.', tone: 'system' };

    case 'action':
      return self ? narrateBlow(event, self, other, key) : null;

    case 'exchange':
      return narrateExchange(event, fighters, key);

    case 'damage': {
      if (!self) return null;
      // A blow's and an exchange's damage is already in their own line.
      if (event.source === 'action' || event.source === 'exchange') return null;
      if (event.source === 'burn') return { text: withAmount(pick(LINES.burn, key)(self), event.amount), tone: 'status' };
      if (event.source === 'clash') return { text: withAmount(pick(LINES.bonus, key)(self, other), event.amount), tone: 'action' };
      return { text: `${rounded(event.amount)} damage to ${self.name}.`, tone: 'action' };
    }

    case 'status': {
      if (!self) return null;
      if (!event.applied) return { text: `${self.name} shakes it off.`, tone: 'status' };
      const set = LINES.status[event.id];
      return set ? { text: pick(set, key)(self), tone: 'status' } : null;
    }

    case 'omen': {
      const set = LINES.omen[event.id];
      return set && self ? { text: pick(set, key)(self, other ?? self), tone: 'omen' } : null;
    }

    // The omen line came before the event opened, and the feed's clash card names it.
    case 'clashStart':
      return null;

    case 'clashEnd': {
      if (!fighters?.[0] || !fighters?.[1]) return null;
      const leader = event.scores.a === event.scores.b ? null : event.scores.a > event.scores.b ? 0 : 1;
      const set = LINES.clash[event.id];
      if (!set) {
        return leader === null
          ? { text: 'Neither gives an inch.', tone: 'momentum' }
          : { text: `${fighters[leader].name} takes the moment.`, tone: 'momentum' };
      }
      if (leader === null) return { text: pick(set.even, key)(fighters[0], fighters[1]), tone: 'momentum' };
      return { text: pick(set.won, key)(fighters[leader], fighters[1 - leader]), tone: 'momentum' };
    }

    case 'ko': {
      const winner = fighters?.[event.winner];
      if (!winner) return null;
      if (event.endReason === 'timeout') return { text: LINES.timeout(winner), tone: 'ko' };
      const loser = fighters?.[event.loser] ?? fighters?.[1 - event.winner] ?? winner;
      return { text: pick(LINES.ko[marginOf(winner)], key)(winner, loser), tone: 'ko' };
    }

    default:
      return null;
  }
}
