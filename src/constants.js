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

/** (spec) From 90s, all damage multiplies by 1.2 every further 15s, compounding. */
export const SUDDEN_DEATH_START_MS = 90_000;
export const SUDDEN_DEATH_STEP_MS = 15_000;
export const SUDDEN_DEATH_FACTOR = 1.2;

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

/** Hard ceiling on battle length, after which the engine declares a result regardless. */
export const MAX_BATTLE_MS = 600_000;

/** Intro beat before the fighting starts: banners, VS flash, sprite entrances. */
export const INTRO_MS = 3000;

/** A hit at or above this fraction of max HP grants the victim a surge charge. */
export const BIG_HIT_FRACTION = 0.15;
