/**
 * A cooling-off period after Meta rate-limits an ad account.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Meta's rate limit (code 17, subcode 2446079) is per AD ACCOUNT. Once it
 * trips, the account is blocked for everyone — every screen, every user, and
 * the publish path too. It clears on its own, but only if the account is left
 * alone: further calls while blocked keep the window rolling, so the natural
 * response to the error message (reload the page) is exactly what stops it
 * clearing.
 *
 * And the app made that easy. Opening the dashboard fired three independent
 * requests that each read Meta; two people had it open; every reload sent the
 * full set again. The error stayed on screen for an afternoon, which reads as
 * "this is broken" rather than "this is recovering".
 *
 * So when a call comes back rate-limited, the account is marked as cooling off
 * and every subsequent Graph call for it fails IMMEDIATELY and locally, without
 * touching Meta, until the window passes. That is not a politer version of the
 * outage — it is the difference between an account that recovers in minutes and
 * one that cannot recover while anybody is watching it.
 *
 * In-process, deliberately. A per-instance breaker still removes the reload
 * loop, which is the dominant cause. A breaker shared across instances belongs
 * with a shared read cache; both are recorded in DEPLOY.md rather than
 * half-built here.
 *
 * This module imports nothing from ./graph on purpose — graph.ts reports rate
 * limits INTO it, and the reverse import would be a cycle.
 * ---------------------------------------------------------------------------
 */

/** How long to leave an account alone after it reports a rate limit. */
const COOLDOWN_MS = 5 * 60 * 1000;

const until = new Map<string, number>();

/** Start (or extend) the cooling-off window for an account. */
export function noteRateLimited(accountId: string | null): void {
  if (!accountId) return;
  until.set(accountId, Date.now() + COOLDOWN_MS);
}

/** Milliseconds left to wait, or 0 when this account is free to call. */
export function cooldownRemaining(accountId: string | null): number {
  if (!accountId) return 0;
  const t = until.get(accountId);
  if (!t) return 0;
  const left = t - Date.now();
  if (left <= 0) {
    until.delete(accountId);
    return 0;
  }
  return left;
}

/** Cleared by hand when somebody wants to try again before the window ends. */
export function clearCooldown(accountId: string): void {
  until.delete(accountId);
}

export class CoolingDownError extends Error {
  readonly accountId: string;
  readonly remainingMs: number;

  constructor(accountId: string, remainingMs: number) {
    const minutes = Math.max(1, Math.ceil(remainingMs / 60000));
    super(
      `Meta rate-limited this ad account, so Cruise is leaving it alone for about ${minutes} more ` +
        `minute${minutes === 1 ? "" : "s"}. The limit is per ad account and clears on its own — but only if nothing ` +
        `keeps calling, so this request was stopped here rather than sent. Nothing is broken and nothing was lost. ` +
        `Publishing to this account is blocked for the same window.`
    );
    this.name = "CoolingDownError";
    this.accountId = accountId;
    this.remainingMs = remainingMs;
  }
}

/** Refuse to call Meta about an account that is cooling off. */
export function assertNotCoolingDown(accountId: string | null): void {
  const left = cooldownRemaining(accountId);
  if (left > 0) throw new CoolingDownError(accountId!, left);
}
