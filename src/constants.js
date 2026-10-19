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
 * stance rebalance, mutual guard banking a Surge charge, a Read on one heavy swing in five — all
 * ship as 1.0.0. The cost is that a replay can no longer tell two engines apart, so the worker
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

/** (spec) Action gauge cadence and its jitter, in milliseconds. */
export const ACTION_CADENCE_MS = 4000;
export const ACTION_JITTER = 0.15;

/** (spec) Chance a clash event fires on an action resolution. ~5 per battle over ~20 actions. */
export const CLASH_CHANCE = 0.2;

/**
 * Chance that a heavy swing's telegraph becomes a Read; otherwise the swing lands at once as a
 * plain overload (1.6x, and the defender banks a Surge charge for reading the wind-up).
 *
 * Not (spec): §3.7 opens a Read on every telegraph. That path runs outside CLASH_CHANCE, so it
 * stacked on top of the ~5 random events: measured over 5,200 balanced mirror matches, a Read
 * was 46% of all clash events (4.2 a battle, 59% for aggressive robots) and a battle held ~9
 * clashes rather than ~5. At one in five a Read is about as common as each other event (~0.8 a
 * battle) and a battle holds ~6.
 */
export const READ_CHANCE_ON_HEAVY = 0.2;

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
