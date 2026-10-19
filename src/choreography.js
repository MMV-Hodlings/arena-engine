/**
 * Semantic events to motion, the way narration.js turns the same events into prose.
 *
 * This is presentation, but it is pure and it is the part worth being sure about: a cue
 * that names the wrong side lunges the wrong robot, and a shake that does not scale turns
 * a burn tick into an earthquake. The frontend has no test framework, so it lives here
 * where `node --test` runs, and the Vue side stays a dispatcher with nothing to get wrong.
 *
 * Nothing here reads or writes battle state. A cue is a request to the stage, and the
 * stage is free to ignore one it has no way to draw.
 */

/** Fraction of max HP at which a hit staggers rather than flinches. */
const STAGGER_FRACTION = 0.15;
/** Below this, a hit is chip damage: a flash, but the camera stays still. */
const SHAKE_FLOOR = 0.02;
/** At or above this, the whole arena feels it. */
const HEAVY_SHAKE_FRACTION = 0.12;

/** Which element each status belongs to, for the aura tint. */
const STATUS_ELEMENT = {
  burn: 'Fire',
  freeze: 'Ice',
  shock: 'Lightning',
  gust: 'Air',
  quake: 'Earth',
  drench: 'Water',
};

const ACTION_ANIMATION = {
  strike: 'strike',
  // A heavy swing; 'overload' is the name older recordings used for the same blow.
  heavy: 'heavy',
  overload: 'heavy',
  surge: 'overload',
  guard: 'guard',
};

const sideOf = (index) => (index === 0 ? 'a' : index === 1 ? 'b' : null);

const figure = (index, animation) => ({ kind: 'figure', side: sideOf(index), animation });

/**
 * @param {object} event one event from the engine's stream
 * @param {Array<object>} fighters the two fighters, for element and maxHp
 * @returns {Array<object>} cues: `figure`, `shake`, `bulletTime`, `fx`
 */
export function choreograph(event, fighters = []) {
  const pair = Array.isArray(fighters) ? fighters : [];
  const index = event?.fighter;
  const side = sideOf(index);

  switch (event?.type) {
    case 'action': {
      if (!side) return [];
      const animation = ACTION_ANIMATION[event.action];
      if (!animation) return [];
      const cues = [figure(index, animation)];

      // The defender has to visibly get out of the way, or a miss looks the same as a
      // hit that happened to do nothing.
      if (event.evaded) cues.push(figure(1 - index, 'evade'));

      if (event.action === 'heavy' || event.action === 'overload') {
        cues.push({ kind: 'shake', strength: 2 });
        cues.push({ kind: 'fx', effect: 'shockwave', side, element: pair[index]?.element ?? null });
      }
      if (event.action === 'surge') {
        cues.push({ kind: 'fx', effect: 'sparks', side, element: pair[index]?.element ?? null });
      }
      return cues;
    }

    case 'damage': {
      if (!side) return [];
      const amount = Number(event.amount) || 0;
      // A hit is made of the attacker's element, so that is what tints the flash.
      const element = pair[1 - index]?.element ?? null;
      const maxHp = Number(pair[index]?.maxHp);
      const fraction = Number.isFinite(maxHp) && maxHp > 0 ? amount / maxHp : null;

      const cues = [];
      // Status ticks are constant and are not blows: they get a number, nothing else.
      if (event.source !== 'status') {
        cues.push(figure(index, fraction !== null && fraction >= STAGGER_FRACTION ? 'stagger' : 'hurt'));
        cues.push({ kind: 'fx', effect: 'impact', side, element, amount });
        if (fraction !== null && fraction >= SHAKE_FLOOR) {
          cues.push({ kind: 'shake', strength: fraction >= HEAVY_SHAKE_FRACTION ? 2 : 1 });
        }
      }
      cues.push({ kind: 'fx', effect: 'damageNumber', side, element, amount: Math.round(amount) });
      return cues;
    }

    case 'status': {
      if (!side || !event.applied) return [];
      return [{ kind: 'fx', effect: 'aura', side, element: STATUS_ELEMENT[event.id] ?? null, status: event.id }];
    }

    // The hint before an event. The Read's is the heavy wind-up it has always been, held on the
    // robot winding up; any other event's is a glow in the robot's own element.
    case 'omen': {
      if (!side) return [];
      if (event.id === 'read') return [figure(index, 'telegraph')];
      return [{ kind: 'fx', effect: 'aura', side, element: pair[index]?.element ?? null }];
    }

    case 'clashStart':
      return [{ kind: 'bulletTime', on: true }];

    case 'clashEnd':
      return [{ kind: 'bulletTime', on: false }];

    case 'ko': {
      // Whatever was open when the last blow landed, the fight ends at normal speed and
      // with nothing still in flight.
      const cues = [{ kind: 'bulletTime', on: false }];
      if (event.endReason === 'timeout') return cues;
      const loser = sideOf(event.loser);
      if (!loser) return cues;
      cues.push(figure(event.loser, 'ko'));
      cues.push({ kind: 'shake', strength: 2 });
      cues.push({ kind: 'fx', effect: 'sparks', side: loser, element: pair[event.loser]?.element ?? null });
      return cues;
    }

    default:
      return [];
  }
}
