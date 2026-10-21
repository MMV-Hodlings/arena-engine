/**
 * Every tunable in the simulation. No other file may contain a magic number.
 * Values marked (spec) are fixed by docs/superpowers/specs/2026-10-15-cyber-authority-pvp-arena-design.md
 * and must not be changed without changing the spec.
 */

/**
 * Stamped on every recorded battle and compared when one is replayed, so a replay rebuilt by
 * a different engine can be flagged instead of quietly showing a fight that never happened.
 *
 * Held at 1.0.0 through development (the owner's call, 2026-10-19): no real player has fought a
 * battle yet, so there is no record a mismatch could protect, and the changes made so far — the
 * stance rebalance, mutual guard banking a Surge charge, and the battle pacing design (events drawn
 * on a rising chance, heavy swings settled at once, omens, briefings, no sudden death) — all ship
 * as 1.0.0. The cost is that a replay can no longer tell two engines apart, so the worker
 * and the frontend must run the same engine commit; a battle rebuilt by a different one is
 * refused rather than flagged. From the first real battle on, bump this in the same change as
 * any edit to the simulation.
 */
export const ENGINE_VERSION = '1.0.0';

/** (spec) Damage pacing constant. ~10 landed hits settle a mirror match at any tier. */
export const K = 0.2;

/** (spec) 604.8 max CP x 5 stars x 3 ratings. Denominator of the Combat Index. */
export const MAX_TOTAL_CS = 9072;

/** (spec) Momentum is the only skill channel and is clamped to this range. */
export const MOMENTUM_MIN = 0.8;
export const MOMENTUM_MAX = 1.2;
export const MOMENTUM_START = 1.0;

/** (spec) Momentum shift per clash event, and the smaller shift the Read event applies. */
export const MOMENTUM_SHIFT = 0.1;
export const MOMENTUM_SHIFT_READ = 0.05;

/** (spec) Total damage swing achievable through skill. Enforced by a property test. */
export const SKILL_INFLUENCE_CAP = 0.2;

/**
 * (pacing design) Action gauge cadence and its jitter, in milliseconds. Six seconds rather than
 * the original four: with two robots that is an action roughly every three seconds, which is a
 * pace a person can read in the log.
 */
export const ACTION_CADENCE_MS = 6000;
export const ACTION_JITTER = 0.15;

/**
 * (pacing design) The least time between any two actions, whichever robot takes them. The two
 * gauges run independently, so without this both robots could act a fraction of a second apart
 * and the log would land two blows at once.
 */
export const MIN_BLOW_GAP_MS = 2000;

/**
 * (pacing design) The chance that an action opens a clash event, by how many actions (either
 * robot's) have passed since the last event closed: 0.3 after one, 0.6 after two, certain on the
 * third. It replaces a flat 20%, which with a Read on every heavy swing gave ~9 events a battle,
 * nearly half of them Reads. Drawing the Read like any other event and rising with each action
 * keeps ~9 events (measured: 8.9 in balanced mirrors) but spreads them evenly: never more than
 * three actions without one, and only 37% straight after another. Forced events ignore it.
 */
export const CLASH_CHANCE_RAMP = Object.freeze([0.3, 0.6, 1]);

/**
 * (pacing design) How long a hint line holds the stage before its event opens. The fight is
 * paused for it: no action resolves between the hint and the event's close. 3s, the owner's call
 * on 2026-10-19 (it was 5s), with the time moved into the briefing below, where the player is
 * told what to do.
 */
export const OMEN_MS = 3000;

/**
 * (pacing design) The briefing before input opens on a timing event (Reflex Strike, Targeting
 * Lock, Sequence Lock, Tug of War, Overload Surge): the event's name, its instruction and its
 * keys. Their windows are the skill being tested, so they keep their lengths and gain this
 * beat in front instead. 5s, the owner's call on 2026-10-19 (it was 2s).
 */
export const BRIEFING_MS = 5000;

/**
 * The feed's beats (owner's request, 2026-10-21): no two lines of the fight land at once. When one
 * moment produces several lines — a blow and the status it ends, a blow and the hint it draws, an
 * event's result and its effect — each after the first is released a beat later on the battle
 * clock, and nothing else happens until the last has had its beat. LINE_BEAT_MS between ordinary
 * lines; HINT_LEAD_MS before an event's hint, so the blow that drew it can be taken in first;
 * RESULT_BEAT_MS between an event's result card, its verdict line and its effect (a Read's
 * exchange, Tug of War's extra hit). The state changes when it happens; only its lines wait.
 */
export const LINE_BEAT_MS = 1500;
export const HINT_LEAD_MS = 2000;
export const RESULT_BEAT_MS = 2000;

/**
 * (pacing design) The window for the two decision events, the Read and Power Routing. Either
 * closes the moment both players have committed, so fifteen seconds is a ceiling, not a wait.
 */
export const DECISION_WINDOW_MS = 15_000;

/** (spec) Element Surge needs this many charges. */
export const SURGE_CHARGES_REQUIRED = 3;

/** Damage variance, applied per landed hit. */
export const VARIANCE = 0.05;

/** (spec) Server-side clamp on mashing. Defeats autoclickers; a fast human reaches ~10. */
export const MAX_TAPS_PER_SECOND = 12;

/** Below this fraction of max HP a robot is "reeling": forces a clash event, shifts action weights. */
export const LOW_HP_FRACTION = 0.25;

/** The largest slice of time one tick may advance. Guards against hibernation wake-ups. */
export const MAX_TICK_STEP_MS = 250;

/**
 * Hard ceiling on battle length, after which the engine declares a result regardless. A hidden
 * safety net, not a mechanic: sudden death is gone (pacing design), and battles end because every
 * robot keeps landing damage. Twenty minutes (2026-10-21), up from fifteen when the feed's beats
 * lengthened every battle: across 15,600 simulated battles the longest (two defensive robots) ran
 * 12m22s, and players who take a whole decision window add about half a minute more.
 */
export const MAX_BATTLE_MS = 1_200_000;

/** Intro beat before the fighting starts: banners, VS flash, sprite entrances. */
export const INTRO_MS = 3000;

/** A hit at or above this fraction of max HP grants the victim a surge charge. */
export const BIG_HIT_FRACTION = 0.15;

/**
 * (pacing design) Narration's sense of size and occasion. A hit under GRAZE_FRACTION of the
 * target's max HP reads as a graze, one at BIG_HIT_FRACTION or more as crushing, anything between
 * as solid. A winner above ROUT_FRACTION of its HP won a rout, one under CLOSE_FRACTION a close
 * finish. HALF_HP_FRACTION and LOW_HP_FRACTION are the lines a hit can take a robot below.
 * A comeback is a crushing hit from a robot at least COMEBACK_GAP behind on HP share; a streak is
 * the STREAK_LENGTH-th damaging hit in a row without taking damage in between.
 */
export const GRAZE_FRACTION = 0.06;
export const ROUT_FRACTION = 0.6;
export const CLOSE_FRACTION = 0.15;
export const HALF_HP_FRACTION = 0.5;
export const COMEBACK_GAP = 0.3;
export const STREAK_LENGTH = 3;
