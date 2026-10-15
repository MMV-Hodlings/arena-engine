/**
 * Semantic events to prose (spec section 5.5).
 *
 * The phrase is chosen by hashing the event itself, not by drawing from the battle's
 * random stream. That means both clients render identical text from identical events with
 * nothing extra to synchronise, and a replay reproduces every line word for word.
 */

import { hashSeed } from './rng.js';

/** Deterministic choice from a list, keyed by the event. */
function pick(list, key) {
  return list[hashSeed(key) % list.length];
}

/**
 * A set name if the robot has one, otherwise a plain fallback. Never prints undefined.
 *
 * A fully synced robot is named after its own set, so naive interpolation produces
 * "Dominus finds the gap in Dominus AI's Dominus plating". When the adjective only
 * repeats the robot's name it is dropped; a distinctive set still earns its mention.
 */
function part(fighter, slot, fallback) {
  const name = fighter?.sets?.[slot];
  if (!name) return fallback;
  const own = String(fighter?.name ?? '');
  if (own === name || own.startsWith(`${name} `)) return fallback;
  return `${name} ${fallback}`;
}

const STRIKE = [
  (f, o) => `${f.name} drives the ${part(f, 'weapon', 'blade')} into ${o.name}'s guard.`,
  (f) => `${f.name} pivots on its ${part(f, 'legs', 'legs')} and strikes clean.`,
  (f) => `A short, brutal exchange — ${f.name} lands first.`,
  (f, o) => `${f.name} finds the gap in ${o.name}'s ${part(o, 'torso', 'plating')}.`,
];

const OVERLOAD = [
  (f) => `${f.name} commits everything to one swing of the ${part(f, 'weapon', 'blade')}.`,
  (f) => `The ${part(f, 'back', 'reactor')} screams as ${f.name} overloads.`,
  (f) => `${f.name} throws its whole frame behind the blow.`,
];

const GUARD = [
  (f) => `${f.name} braces behind its ${part(f, 'torso', 'plating')}.`,
  (f) => `${f.name} holds, conserving power.`,
  (f) => `${f.name} tucks in and waits.`,
];

const SURGE = [
  (f) => `${f.name} channels ${f.element} through the ${part(f, 'weapon', 'core')} and releases it.`,
  (f) => `${f.element} floods the arena as ${f.name} surges.`,
];

const TELEGRAPH = [
  (f) => `${f.name} drops its shoulder and the ${part(f, 'weapon', 'blade')} begins to glow —`,
  (f) => `${f.name} winds up. Something big is coming —`,
];

const EVADED = [
  (f, o) => `${o.name} is not there any more — the blow finds empty air.`,
  (f, o) => `${o.name} slips aside at the last instant.`,
];

const STATUS_TEXT = {
  burn: (f) => `Fire catches in ${f.name}'s ${part(f, 'torso', 'plating')}. It is burning.`,
  freeze: (f) => `Ice locks ${f.name}'s joints solid — it is frozen in place.`,
  shock: (f) => `Current arcs across ${f.name}'s armour. Its guard is failing.`,
  gust: (f) => `Wind coils around ${f.name}. It is hard to pin down.`,
  quake: (f) => `The ground bucks and ${f.name} is left staggering.`,
  drench: (f) => `Water floods ${f.name}'s systems and bleeds its charge away.`,
};

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

    case 'action': {
      if (!self) return null;
      if (event.evaded) return { text: pick(EVADED, key)(self, other), tone: 'action' };
      if (event.action === 'guard') return { text: pick(GUARD, key)(self, other), tone: 'action' };
      if (event.action === 'overload') return { text: pick(OVERLOAD, key)(self, other), tone: 'crit' };
      if (event.action === 'surge') return { text: pick(SURGE, key)(self, other), tone: 'crit' };
      if (event.action === 'telegraph') return { text: pick(TELEGRAPH, key)(self, other), tone: 'crit' };
      return { text: pick(STRIKE, key)(self, other), tone: 'action' };
    }

    case 'damage': {
      if (!self) return null;
      const amount = Math.round(event.amount);
      if (event.source === 'burn') {
        return { text: `Burn eats through ${self.name}'s armour. ${amount}.`, tone: 'status' };
      }
      if (event.source === 'exchange') {
        return { text: `${self.name} takes it full on. ${amount}.`, tone: 'crit' };
      }
      return { text: `${amount} damage to ${self.name}.`, tone: 'action' };
    }

    case 'status': {
      if (!self) return null;
      if (!event.applied) return { text: `${self.name} shakes it off.`, tone: 'status' };
      const template = STATUS_TEXT[event.id];
      return template ? { text: template(self), tone: 'status' } : null;
    }

    case 'exchange':
      return { text: `Blades lock — ${event.stances.a} against ${event.stances.b}.`, tone: 'crit' };

    case 'clashStart':
      return { text: 'Time slows.', tone: 'system' };

    case 'clashEnd': {
      const leader = event.scores.a === event.scores.b ? null : event.scores.a > event.scores.b ? 0 : 1;
      if (leader === null) return { text: 'Neither gives an inch.', tone: 'momentum' };
      return { text: `${fighters[leader].name} seizes the momentum.`, tone: 'momentum' };
    }

    case 'suddenDeath':
      return { text: 'Reactors redline. Everything hits harder from here.', tone: 'system' };

    case 'ko': {
      const winner = fighters?.[event.winner];
      if (!winner) return null;
      if (event.endReason === 'timeout') {
        return { text: `Time. ${winner.name} is left standing taller.`, tone: 'ko' };
      }
      return { text: `${winner.name} stands over the wreckage.`, tone: 'ko' };
    }

    default:
      return null;
  }
}
