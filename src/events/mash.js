/**
 * Shared plumbing for the mashing events. Clients never send one message per keypress:
 * they count locally and post an aggregate about ten times a second. The server clamps
 * each window to a plausible human rate and ignores replayed sequence numbers, so neither
 * an autoclicker nor a retry loop can inflate a score.
 */

import { MAX_TAPS_PER_SECOND } from '../constants.js';

/** @returns {{taps: number, lastSeq: number}} */
export function emptyMashSide() {
  return { taps: 0, lastSeq: -1 };
}

/**
 * The clamp budgets taps against the time the SERVER says has elapsed since the event
 * opened. Two earlier versions of this were both defeatable:
 *
 *   - clamping each window on its own: at a 100ms window the ceiling rounds 1.2 up to 2,
 *     so a client posting 3 taps every window banks 20/s against a cap of 12;
 *   - budgeting against an elapsed time accumulated from the client's own `windowMs`:
 *     one message claiming `{taps: 1e9, windowMs: 1e9}` banks twelve million taps.
 *
 * The only trustworthy clock is the arrival time the reducer already validates against
 * the open window, so that is what the budget is computed from. `windowMs` in the payload
 * is now client telemetry and is not read.
 *
 * @param {{taps: number, lastSeq: number}} side
 * @param {{taps: number, seq: number}} payload
 * @param {number} elapsedMs server-validated milliseconds since the event opened
 * @returns {{taps: number, lastSeq: number}}
 */
export function acceptTaps(side, payload, elapsedMs) {
  const taps = Number(payload?.taps);
  const seq = Number(payload?.seq);

  if (!Number.isFinite(taps) || taps <= 0) return side;
  if (!Number.isFinite(seq) || seq <= side.lastSeq) return side;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return side;

  const budget = Math.ceil((elapsedMs / 1000) * MAX_TAPS_PER_SECOND);
  const allowance = Math.max(0, budget - side.taps);

  return {
    taps: side.taps + Math.min(Math.floor(taps), allowance),
    lastSeq: seq,
  };
}
