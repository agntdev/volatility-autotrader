/**
 * Injectable clock seam — every schedule, cutoff, "today", and expiry decision
 * goes through now() so tests can freeze time without patching Date globally.
 */

let _now: () => number = () => Date.now();

/** Current wall-clock time in epoch milliseconds. */
export function now(): number {
  return _now();
}

/** Override the clock (tests). Pass no args to restore the real clock. */
export function setNow(fn?: () => number): void {
  _now = fn ?? (() => Date.now());
}

/** ISO-ish short timestamp for user-facing trade lists (UTC). */
export function formatTime(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min} UTC`;
}
