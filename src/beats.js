/**
 * The feed's beats: one moment's events, spread so that no two lines of the fight land at once.
 *
 * A moment is everything one resolution produces at a single battle time — an action with its
 * damage, the status it ends and the hint it draws; an event's close with its verdict and effect.
 * Its first line keeps the moment's time; every later line is released a beat after the one before
 * (constants.js: LINE_BEAT_MS, HINT_LEAD_MS, RESULT_BEAT_MS). An event that is not a line of its
 * own (a damage number, a surge charge) travels with the line before it, so the stage changes when
 * its line appears.
 */
import { narrate } from './narration.js';
import { LINE_BEAT_MS, HINT_LEAD_MS, RESULT_BEAT_MS } from './constants.js';

/** Whether an event shows in the feed: a narrated line, or one of the event cards. */
export function isFeedLine(event, fighters) {
  if (event?.type === 'clashStart' || event?.type === 'clashEnd') return true;
  return narrate(event, fighters) !== null;
}

function beatBefore(event, afterVerdict) {
  if (event.type === 'omen') return HINT_LEAD_MS;
  if (event.type === 'clashVerdict') return RESULT_BEAT_MS;
  // An event's effect follows its verdict by the same beat; a K.O. it causes, by an ordinary one.
  if (afterVerdict && event.type !== 'ko') return RESULT_BEAT_MS;
  return LINE_BEAT_MS;
}

/**
 * @param {object[]} events one moment's events, in the order they happened
 * @param {number} base the time the moment's first line lands
 * @returns {object[]} the same events, each stamped with the time it is released
 */
export function spaceMoment(events, base, fighters) {
  // A K.O. closes its moment: in an exchange both hits land, so a lethal first hit's K.O. waits for
  // the second hit's damage rather than carrying it a beat late.
  const ordered = [...events.filter((e) => e.type !== 'ko'), ...events.filter((e) => e.type === 'ko')];
  const isLine = ordered.map((event) => isFeedLine(event, fighters));

  // Each line's offset: a beat after the line before it.
  const offsets = new Array(ordered.length).fill(null);
  let offset = 0;
  let seenLine = false;
  let afterVerdict = false;
  ordered.forEach((event, i) => {
    if (!isLine[i]) return;
    if (seenLine) offset += beatBefore(event, afterVerdict);
    seenLine = true;
    if (event.type === 'clashVerdict') afterVerdict = true;
    offsets[i] = offset;
  });

  // Everything else travels with a line: a robot's move with the line that tells it (a heavy swing
  // is told by its exchange), its damage and charges with the line before them.
  const nextLine = (i) => { for (let k = i + 1; k < ordered.length; k++) if (isLine[k]) return offsets[k]; return null; };
  const prevLine = (i) => { for (let k = i - 1; k >= 0; k--) if (isLine[k]) return offsets[k]; return null; };
  return ordered.map((event, i) => {
    let at = offsets[i];
    if (at === null) at = event.type === 'action' ? (nextLine(i) ?? prevLine(i) ?? 0) : (prevLine(i) ?? nextLine(i) ?? 0);
    return { ...event, t: base + at };
  });
}
