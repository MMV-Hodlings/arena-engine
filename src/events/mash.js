/**
 * Shared plumbing for the mashing events. Clients never send one message per keypress:
 * they count locally and post an aggregate about ten times a second. The server clamps
 * each window to a plausible human rate and ignores replayed sequence numbers, so neither
 * an autoclicker nor a retry loop can inflate a score.
 */

import { MAX_TAPS_PER_SECOND } from '../constants.js';

/** @returns {{taps: number, lastSeq: number, elapsedMs: number}} */
export function emptyMashSide() {
  return { taps: 0, lastSeq: -1, elapsedMs: 0 };
}

/**
 * The clamp is CUMULATIVE, not per window. Clamping each window on its own looks right
 * but is defeatable: at a 100ms window the per-window ceiling rounds 1.2 up to 2, so a
 * client posting 3 taps every window banks 2 every time — 20 per second against a cap of
 * 12. Budgeting against total elapsed time closes that, and rounding up only once means
 * an honest player is never short-changed by the rounding.
 *
 * @param {{taps: number, lastSeq: number, elapsedMs: number}} side
 * @param {{taps: number, windowMs: number, seq: number}} payload
 * @returns {{taps: number, lastSeq: number, elapsedMs: number}}
 */
export function acceptTaps(side, payload) {
  const taps = Number(payload?.taps);
  const windowMs = Number(payload?.windowMs);
  const seq = Number(payload?.seq);

  if (!Number.isFinite(taps) || taps <= 0) return side;
  if (!Number.isFinite(windowMs) || windowMs <= 0) return side;
  if (!Number.isFinite(seq) || seq <= side.lastSeq) return side;

  const elapsedMs = side.elapsedMs + windowMs;
  const budget = Math.ceil((elapsedMs / 1000) * MAX_TAPS_PER_SECOND);
  const allowance = Math.max(0, budget - side.taps);

  return {
    taps: side.taps + Math.min(Math.floor(taps), allowance),
    lastSeq: seq,
    elapsedMs,
  };
}
