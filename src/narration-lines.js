/**
 * Every line the arena says, in one place, so the copy can be read and edited without touching
 * the logic that picks it (narration.js). Templates return prose only: narration.js appends the
 * numbers ("— 84", "— 52 to Bulwark, 31 to Vanguard") so every line formats them the same way.
 *
 * The rules this copy keeps (battle pacing design, section 8):
 *   - a hint (omen) never names its event or its control;
 *   - a stance exchange is told as a contest, never as "overload against guard";
 *   - a robot's equipped sets appear where they fit, through `part()`.
 * The owner signs off the copy before it ships.
 */

/**
 * A set name if the robot has one, otherwise a plain fallback. Never prints undefined.
 *
 * A fully synced robot is named after its own set, so naive interpolation produces
 * "Dominus finds the gap in Dominus AI's Dominus plating". When the adjective only
 * repeats the robot's name it is dropped; a distinctive set still earns its mention.
 */
export function part(fighter, slot, fallback) {
  const name = fighter?.sets?.[slot];
  if (!name) return fallback;
  const own = String(fighter?.name ?? '');
  if (own === name || own.startsWith(`${name} `)) return fallback;
  return `${name} ${fallback}`;
}

export const LINES = Object.freeze({
  /** A strike, by size. (f = attacker, o = target) */
  blow: {
    graze: [
      (f, o) => `${f.name} clips ${o.name}'s ${part(o, 'torso', 'plating')}.`,
      (f, o) => `${f.name}'s ${part(f, 'weapon', 'blade')} skims off ${o.name}'s guard.`,
      (f, o) => `A glancing touch from ${f.name}. ${o.name} barely notices.`,
      (f, o) => `${f.name} nicks ${o.name} on the way past.`,
      (f, o) => `Sparks and little else: ${f.name} only grazes ${o.name}.`,
      (f, o) => `${f.name} finds an inch of ${o.name}'s ${part(o, 'helmet', 'visor')} and no more.`,
      (f, o) => `${o.name} turns most of ${f.name}'s strike aside.`,
      (f, o) => `${f.name} scrapes paint from ${o.name}'s ${part(o, 'legs', 'legs')}.`,
      (f, o) => `A probing jab from ${f.name}, testing ${o.name}'s guard.`,
    ],
    solid: [
      (f, o) => `${f.name} drives the ${part(f, 'weapon', 'blade')} into ${o.name}'s guard.`,
      (f) => `${f.name} pivots on its ${part(f, 'legs', 'legs')} and strikes clean.`,
      (f) => `A short, brutal exchange, and ${f.name} lands first.`,
      (f, o) => `${f.name} finds the gap in ${o.name}'s ${part(o, 'torso', 'plating')}.`,
      (f) => `${f.name} steps in and the ${part(f, 'weapon', 'blade')} bites deep.`,
      (f) => `${f.name} turns its ${part(f, 'torso', 'frame')} behind a clean, hard hit.`,
      (f, o) => `${o.name} rocks back as ${f.name} connects square.`,
      (f, o) => `${f.name} rides its ${part(f, 'legs', 'legs')} forward and hammers ${o.name}.`,
      (f) => `${f.name} reads the opening and punishes it.`,
      (f, o) => `Steel on steel: ${f.name} lands on ${o.name}'s ${part(o, 'helmet', 'visor')}.`,
    ],
    crushing: [
      (f, o) => `${f.name} commits everything, and the ${part(f, 'weapon', 'blade')} caves ${o.name}'s ${part(o, 'torso', 'plating')} in.`,
      (f, o) => `A crushing blow from ${f.name}. ${o.name}'s frame buckles.`,
      (f, o) => `${f.name} catches ${o.name} flush, and the arena shakes.`,
      (f, o) => `The ${part(f, 'back', 'reactor')} roars as ${f.name} smashes through ${o.name}'s guard.`,
      (f, o) => `${o.name} is thrown back by ${f.name}'s full weight.`,
      (f, o) => `${f.name} tears a strip of armour off ${o.name}.`,
      (f, o) => `Warning lights flare on ${o.name}: ${f.name} hit something vital.`,
      (f) => `${f.name}'s ${part(f, 'weapon', 'blade')} lands like a falling girder.`,
      (f, o) => `${f.name} unloads on ${o.name}, and the plating gives.`,
    ],
  },

  /** A strike that made a moment; it replaces the plain line. (f = attacker, o = target) */
  moment: {
    firstBlood: [
      (f) => `First blood to ${f.name}.`,
      (f, o) => `${f.name} draws first blood from ${o.name}.`,
      (f) => `The first hit of the fight belongs to ${f.name}.`,
    ],
    half: [
      (f, o) => `${f.name} knocks ${o.name} below half.`,
      (f, o) => `${o.name} is past halfway down after that one from ${f.name}.`,
      (f, o) => `${f.name} has ${o.name} on the back foot, its armour half gone.`,
    ],
    quarter: [
      (f, o) => `${o.name} is reeling, and ${f.name} smells the finish.`,
      (f, o) => `${f.name} drives ${o.name} into the red.`,
      (f, o) => `Alarms blare on ${o.name}: ${f.name} has it hanging by a thread.`,
    ],
    streak: [
      (f, o) => `Three in a row for ${f.name}. ${o.name} cannot find an answer.`,
      (f) => `${f.name} keeps coming: a third clean hit without reply.`,
      (f, o) => `${f.name} is on a run, and ${o.name} is running out of guard.`,
    ],
    comeback: [
      (f, o) => `${f.name} is not done yet: a huge hit claws back ground on ${o.name}.`,
      (f, o) => `Out of nowhere, ${f.name} rocks ${o.name}.`,
      (f) => `${f.name} answers from the brink with a crushing blow.`,
    ],
  },

  /** A strike that found nothing. (f = attacker, o = target) */
  evaded: [
    (f, o) => `${o.name} is not there any more. The blow finds empty air.`,
    (f, o) => `${o.name} slips aside at the last instant.`,
    (f) => `${f.name} swings through a gust and hits nothing.`,
  ],

  /** (f = the robot guarding, o = the other) */
  guard: [
    (f) => `${f.name} braces behind its ${part(f, 'torso', 'plating')}.`,
    (f) => `${f.name} holds, conserving power.`,
    (f) => `${f.name} tucks in and waits.`,
    (f) => `${f.name} sets its ${part(f, 'legs', 'legs')} and raises its guard.`,
    (f) => `${f.name} gives ground and banks a charge.`,
    (f, o) => `${f.name} watches ${o.name} and keeps its guard high.`,
    (f) => `Shields up on ${f.name}. Power trickles into reserve.`,
  ],

  /** An Element Surge, by the surging robot's element. (f = surging, o = target) */
  surge: {
    Fire: [
      (f, o) => `${f.name} vents a column of fire into ${o.name}.`,
      (f) => `The ${part(f, 'weapon', 'core')} glows white-hot as ${f.name} releases its surge.`,
      (f) => `Flame pours from ${f.name}'s frame across the arena.`,
    ],
    Water: [
      (f, o) => `${f.name} hits ${o.name} with a crushing torrent.`,
      (f) => `Coolant floods the arena as ${f.name} surges.`,
      (f, o) => `${f.name} drives a wall of water into ${o.name}.`,
    ],
    Air: [
      (f, o) => `${f.name} tears the air open around ${o.name}.`,
      (f) => `A cyclone spins off ${f.name}'s ${part(f, 'back', 'thrusters')}.`,
      (f) => `${f.name} surges, and the wind howls.`,
    ],
    Earth: [
      (f, o) => `${f.name} splits the arena floor under ${o.name}.`,
      (f) => `Stone erupts as ${f.name} drives its surge into the ground.`,
      (f) => `${f.name} shakes the whole arena.`,
    ],
    Lightning: [
      (f, o) => `${f.name} discharges a bolt straight into ${o.name}.`,
      (f) => `Arcs leap from ${f.name}'s ${part(f, 'weapon', 'core')}.`,
      (f) => `The lights flicker as ${f.name} surges.`,
    ],
    Ice: [
      (f, o) => `${f.name} freezes the air between itself and ${o.name}.`,
      (f) => `Frost races across the arena from ${f.name}.`,
      (f) => `${f.name} lets loose a lance of ice.`,
    ],
  },
  /** A surge from a robot whose element narration does not know. */
  surgeAny: [
    (f) => `${f.name} channels its element through the ${part(f, 'weapon', 'core')} and releases it.`,
  ],

  /** A status landing. (f = the robot it lands on) */
  status: {
    burn: [
      (f) => `Fire catches in ${f.name}'s ${part(f, 'torso', 'plating')}. It is burning.`,
      (f) => `Flames crawl over ${f.name}'s armour.`,
      (f) => `${f.name} is alight, and every move feeds the fire.`,
    ],
    freeze: [
      (f) => `Ice locks ${f.name}'s joints solid. It is frozen in place.`,
      (f) => `${f.name} freezes mid-step, rimed in ice.`,
      (f) => `Frost seals ${f.name}'s servos. It is frozen.`,
    ],
    shock: [
      (f) => `Current arcs across ${f.name}'s armour. Its guard is failing.`,
      (f) => `${f.name} jerks as the charge shorts its shielding.`,
      (f) => `Static crawls over ${f.name}, and its defences flicker.`,
    ],
    gust: [
      (f) => `Wind coils around ${f.name}. It is hard to pin down.`,
      (f) => `${f.name} rides a sudden gust, light on its feet.`,
      (f) => `The air bends around ${f.name}.`,
    ],
    quake: [
      (f) => `The ground bucks and ${f.name} is left staggering.`,
      (f) => `${f.name} loses its footing as the floor heaves.`,
      (f) => `Tremors rattle ${f.name}'s balance.`,
    ],
    drench: [
      (f) => `Water floods ${f.name}'s systems and bleeds its charge away.`,
      (f) => `${f.name} sputters, its reserves soaked.`,
      (f) => `A deluge drains ${f.name}'s stored power.`,
    ],
  },

  /** Burn ticking. (f = the burning robot) */
  burn: [
    (f) => `Burn eats through ${f.name}'s armour.`,
    (f) => `${f.name} burns on.`,
  ],

  /** An event's bonus hit on the robot that lost it. (f = the robot hit) */
  bonus: [
    (f) => `${f.name} pays for losing that.`,
    (f) => `${f.name} takes the follow-up.`,
  ],

  /**
   * A heavy swing, by how the target answered. The swinger always overloads.
   * (s = swinger, a = the robot answering)
   */
  heavy: {
    strike: [
      (s, a) => `${a.name} reads the wind-up and steps inside ${s.name}'s swing.`,
      (s, a) => `${s.name} winds up, and ${a.name} hits it mid-swing, blunting the blow.`,
      (s, a) => `${a.name} catches ${s.name} mid-swing, wide open.`,
    ],
    guard: [
      (s, a) => `${s.name} brings everything down on ${a.name}'s raised guard, and the guard buckles.`,
      (s, a) => `${a.name} braces, but ${s.name}'s heavy swing crashes through.`,
      (s, a) => `${s.name} hammers ${a.name}'s guard flat.`,
    ],
    overload: [
      (s, a) => `${s.name} and ${a.name} both swing for the fences. Both connect.`,
      (s, a) => `Two heavy blows land at once. ${s.name} and ${a.name} reel apart.`,
      (s, a) => `${a.name} meets ${s.name}'s wind-up with its own, and the arena shakes.`,
    ],
  },

  /** A Read's exchange, by the two stances 'a-b'. (a = fighter A, b = fighter B) */
  read: {
    'strike-strike': [
      (a, b) => `${a.name} and ${b.name} trade straight blows.`,
      (a, b) => `Neither flinches: ${a.name} and ${b.name} hit each other clean.`,
    ],
    'strike-guard': [
      (a, b) => `${b.name} parries ${a.name}'s strike and answers.`,
      (a, b) => `${a.name} strikes into ${b.name}'s guard and pays for it.`,
    ],
    'strike-overload': [
      (a, b) => `${a.name} catches ${b.name} mid-wind-up and blunts the heavy blow.`,
      (a, b) => `${b.name} winds up, and ${a.name} punishes the opening.`,
    ],
    'guard-strike': [
      (a, b) => `${a.name} parries ${b.name}'s strike and answers.`,
      (a, b) => `${b.name} strikes into ${a.name}'s guard and pays for it.`,
    ],
    'guard-guard': [
      (a, b) => `${a.name} and ${b.name} both hold. Power builds on both sides.`,
      (a, b) => `A standoff: ${a.name} and ${b.name} brace and bank their charge.`,
    ],
    'guard-overload': [
      (a, b) => `${b.name} smashes through ${a.name}'s guard.`,
      (a, b) => `${a.name} braces, and ${b.name}'s heavy blow caves the guard in.`,
    ],
    'overload-strike': [
      (a, b) => `${b.name} catches ${a.name} mid-wind-up and blunts the heavy blow.`,
      (a, b) => `${a.name} winds up, and ${b.name} punishes the opening.`,
    ],
    'overload-guard': [
      (a, b) => `${a.name} smashes through ${b.name}'s guard.`,
      (a, b) => `${b.name} braces, and ${a.name}'s heavy blow caves the guard in.`,
    ],
    'overload-overload': [
      (a, b) => `${a.name} and ${b.name} both swing heavy, and both land.`,
      (a, b) => `Two full swings collide. ${a.name} and ${b.name} stagger apart.`,
    ],
  },

  /**
   * The hint before each event. Never the event's name or its control: a player who pays
   * attention learns to recognise them. (f = the robot whose action drew the event, o = the other)
   */
  omen: {
    read: [
      (f) => `${f.name} plants its feet and draws the ${part(f, 'weapon', 'blade')} back.`,
      (f) => `${f.name} drops its shoulder. Something heavy is coming.`,
      (f) => `${f.name}'s ${part(f, 'back', 'reactor')} spools up for one big swing.`,
      (f, o) => `${f.name} winds up slowly, daring ${o.name} to guess.`,
    ],
    reflexStrike: [
      (f) => `${f.name}'s optics narrow to a pinpoint.`,
      (f) => `${f.name} goes perfectly still, waiting for an opening.`,
      (f, o) => `${f.name} and ${o.name} circle, each waiting for the other to blink.`,
      (f) => `${f.name}'s servos tense like a drawn spring.`,
    ],
    targetingLock: [
      (f) => `A targeting lattice flickers across ${f.name}'s visor.`,
      (f, o) => `${f.name} sweeps ${o.name} for a weak point.`,
      (f, o) => `Crosshairs drift across ${o.name}'s frame as ${f.name} takes aim.`,
      (f, o) => `${f.name}'s ${part(f, 'helmet', 'sensors')} settle on ${o.name}'s outline.`,
    ],
    tugOfWar: [
      (f, o) => `${f.name} and ${o.name} lock together, servos straining.`,
      (f, o) => `${f.name} grabs hold of ${o.name}, and neither lets go.`,
      (f, o) => `${f.name} hooks ${o.name}'s arm. This will come down to raw pull.`,
      (f, o) => `Metal grinds as ${f.name} and ${o.name} brace against each other.`,
    ],
    overloadSurge: [
      (f) => `${f.name}'s reactor whine climbs past the safe band.`,
      (f) => `Heat shimmers off ${f.name} as its core runs hot.`,
      (f, o) => `${f.name}'s ${part(f, 'back', 'reactor')} starts to glow, and ${o.name}'s answers.`,
      (f, o) => `Both cores roar. ${f.name} and ${o.name} are pushing past their limits.`,
    ],
    sequenceLock: [
      (f) => `Firewall glyphs scroll across ${f.name}'s HUD.`,
      (f, o) => `${f.name} reaches for ${o.name}'s systems with a burst of code.`,
      (f, o) => `A handshake request flashes from ${f.name} to ${o.name}.`,
      (f) => `${f.name}'s visor fills with scrolling command strings.`,
    ],
    powerRouting: [
      (f) => `${f.name}'s power bus spikes, waiting to be routed.`,
      (f) => `Reserves pool in ${f.name}'s core, ready to be spent.`,
      (f, o) => `${f.name} and ${o.name} both pull back to redistribute power.`,
      (f) => `Spare charge hums through ${f.name}'s frame, looking for somewhere to go.`,
    ],
  },

  /** How each event ended. won: (winner, loser); even: (a, b). */
  clash: {
    read: {
      won: [(w) => `${w.name} reads it right.`, (w) => `${w.name} calls the swing and wins the exchange.`],
      even: [(a, b) => `${a.name} and ${b.name} read each other perfectly.`, (a, b) => `Neither ${a.name} nor ${b.name} gets the better of that one.`],
    },
    reflexStrike: {
      won: [(w) => `${w.name} strikes first. Perfect timing.`, (w) => `${w.name} wins it by a hair.`],
      even: [(a, b) => `${a.name} and ${b.name} fire at the same instant.`, (a, b) => `Dead even timing from ${a.name} and ${b.name}.`],
    },
    targetingLock: {
      won: [(w) => `${w.name}'s crosshair settles dead on the weak point.`, (w) => `${w.name} finds the mark first.`],
      even: [(a, b) => `Both crosshairs land together: ${a.name} and ${b.name} are level.`, (a, b) => `${a.name} and ${b.name} each find a mark.`],
    },
    tugOfWar: {
      won: [(w, l) => `${w.name} wrenches ${l.name} off balance.`, (w, l) => `${w.name} wins the pull and drags ${l.name} in.`],
      even: [(a, b) => `${a.name} and ${b.name} strain to a dead stop.`, () => 'Neither frame gives an inch.'],
    },
    overloadSurge: {
      won: [(w) => `${w.name}'s core burns brighter.`, (w) => `${w.name} pushes harder and comes out charged.`],
      even: [(a, b) => `${a.name} and ${b.name} both run their cores into the red.`, () => 'Two cores at full power, and nothing to separate them.'],
    },
    sequenceLock: {
      won: [(w) => `${w.name} breaks the firewall first.`, (w) => `${w.name}'s code gets through clean.`],
      even: [(a, b) => `${a.name} and ${b.name} crack the sequence together.`, () => 'The hack ends level.'],
    },
    powerRouting: {
      won: [(w) => `${w.name} routes its power smarter.`, (w) => `${w.name} comes out of it better charged.`],
      even: [(a, b) => `${a.name} and ${b.name} reroute their reserves.`, () => 'Power shifts inside both frames, ready for what comes next.'],
    },
  },

  /** How the battle ended, by the winner's remaining HP. (w = winner, l = loser) */
  ko: {
    rout: [
      (w) => `${w.name} stands over the wreckage, barely scratched.`,
      (w, l) => `A rout. ${w.name} took ${l.name} apart.`,
      (w) => `${w.name} walks away almost untouched.`,
    ],
    clear: [
      (w) => `${w.name} stands over the wreckage.`,
      (w, l) => `${l.name} goes down, and ${w.name} takes it.`,
      (w) => `${w.name} finishes the job.`,
    ],
    close: [
      (w, l) => `${w.name} is still standing, just. ${l.name} is not.`,
      (w, l) => `By a thread: ${w.name} outlasts ${l.name}.`,
      (w) => `${w.name} wins it on its last reserves.`,
    ],
  },
  timeout: (w) => `Time. ${w.name} is left standing taller.`,
});
