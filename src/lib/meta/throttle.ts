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
 * WHY IT IS IN THE DATABASE
 *
 * The first version of this kept the window in a Map, in memory. That is a
 * breaker only as good as the process holding it. On Vercel each request may
 * land on a different instance with an empty map, so an account could be
 * rate-limited, visibly blocked, and still receive a full set of calls from the
 * next cold start — and from the other person with the tab open. BikeDekho
 * stayed blocked for hours that way.
 *
 * One row, read once per request, makes the window mean the same thing on every
 * instance. The in-memory layer survives as a short-lived memo in front of it,
 * so this costs one indexed read every few seconds rather than one per call.
 * ---------------------------------------------------------------------------
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { metaCooldowns } from "../db/schema";

/** The least time to leave an account alone, when Meta gives no estimate. */
const COOLDOWN_MS = 5 * 60 * 1000;

/**
 * The most we will wait on OUR OWN guess.
 *
 * An hour is long enough for any ordinary window, and a guess should never take
 * an account offline for half a working day.
 */
const MAX_GUESS_MS = 60 * 60 * 1000;

/**
 * The most we will wait when META ITSELF names a number.
 *
 * This used to be the same hour, and that hour was the bug. Meta answers
 * `estimated_time_to_regain_access` in minutes, and for an account that has
 * tripped repeatedly it can be several hours. Capping at one meant the app
 * waited an hour, retried into a door that was still shut, was refused — and
 * every refused call rolls the window forward again. From the outside that is
 * indistinguishable from permanently broken, which is what Media Sales looked
 * like for days.
 *
 * Four hours is a long time to have an account dark, so this ceiling applies
 * only to a figure Meta stated. Our own escalation stays under MAX_GUESS_MS.
 */
const MAX_META_MS = 4 * 60 * 60 * 1000;

/**
 * Tripping again within this long of the last window ending counts as not
 * having recovered, so the next window doubles.
 *
 * Without it, an account that needs four hours is poked every five minutes
 * forever and never gets them.
 */
const ESCALATION_WINDOW_MS = 30 * 60 * 1000;

/**
 * The share of Meta's per-account allowance at which we stop on our own.
 *
 * Meta reports usage on SUCCESSFUL responses too — `call_count`,
 * `total_cputime` and `total_time`, each as a percentage of the limit. Waiting
 * for the error is waiting for the damage: by the time code 17 arrives the
 * account is already blocked for everyone, publishing included, and every
 * hopeful reload extends it. Standing down at four fifths costs a few minutes
 * of staleness and avoids the block rather than reacting to it.
 */
export const SOFT_LIMIT_PCT = 80;

/** How long to stand down when we stop ourselves, absent a stated reset. */
const SOFT_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * How long a DB answer is trusted before being read again.
 *
 * Short on purpose. The cost of being a few seconds stale is a handful of calls
 * that should not have been made; the cost of caching it for minutes is a
 * cooling-off window that outlives the block, or one that starts late.
 */
const MEMO_MS = 10 * 1000;

interface Memo {
  until: number;
  checkedAt: number;
}

const memo = new Map<string, Memo>();

/**
 * Record that Meta pushed back on this account.
 *
 * Memory is updated first so THIS instance stops immediately even if the shared
 * write fails; the write itself is awaited but swallowed on error, because
 * throwing here would replace a rate-limit error with a database error and hide
 * what actually happened.
 */
export async function noteRateLimited(
  accountId: string | null,
  reason?: string,
  windowMs?: number
): Promise<void> {
  if (!accountId) return;
  const now = Date.now();

  // How many windows in a row this account has failed to recover from. Read
  // before writing, because the answer changes how long to wait — one extra
  // indexed read on a request that has already failed.
  let strikes = 1;
  try {
    const rows = await db
      .select({ until: metaCooldowns.until, strikes: metaCooldowns.strikes })
      .from(metaCooldowns)
      .where(eq(metaCooldowns.accountId, accountId))
      .limit(1);
    const prior = rows[0];
    if (prior) {
      const endedAgo = now - prior.until.getTime();
      // Still inside the last window, or only just out of it: the last window
      // was not long enough. Anything older is a fresh incident.
      if (endedAgo < ESCALATION_WINDOW_MS) strikes = Math.min(prior.strikes + 1, 8);
    }
  } catch {
    /* no history is the same as a first strike */
  }

  // Meta's own estimate when it gave one — that figure gets the long ceiling,
  // because it is an answer rather than a guess. Absent one, back off by
  // doubling from the minimum, under the short ceiling.
  const stated = windowMs && windowMs > 0 ? Math.min(windowMs, MAX_META_MS) : 0;
  const guessed = Math.min(COOLDOWN_MS * 2 ** (strikes - 1), MAX_GUESS_MS);
  const wait = Math.max(COOLDOWN_MS, stated, guessed);
  const until = now + wait;
  memo.set(accountId, { until, checkedAt: now });

  // AWAITED, not fire-and-forget. On Vercel the function can be frozen as soon
  // as the response is sent, so a floating promise here often never reached
  // Postgres — the breaker recorded nothing in production while working
  // perfectly in development.
  await db
    .insert(metaCooldowns)
    .values({ accountId, until: new Date(until), reason: reason ?? null, strikes, noticedAt: new Date() })
    .onConflictDoUpdate({
      target: metaCooldowns.accountId,
      // Extend, never shorten: a second rate limit while cooling off means the
      // account needs longer, not that the clock restarts shorter.
      set: {
        until: sql`GREATEST(${metaCooldowns.until}, EXCLUDED.until)`,
        reason: reason ?? null,
        strikes: sql`GREATEST(${metaCooldowns.strikes}, EXCLUDED.strikes)`,
        noticedAt: new Date(),
      },
    })
    .catch(() => {
      /* best effort — see above */
    });
}

/**
 * Stand down because Meta says we are close to the limit, not because we hit it.
 *
 * Called from the response path on SUCCESSFUL calls. Deliberately does NOT
 * count as a strike: nothing went wrong, and escalating on a voluntary pause
 * would punish the app for behaving well. It also never shortens an existing
 * window, so a real rate limit always wins.
 */
export async function noteApproachingLimit(
  accountId: string | null,
  percent: number,
  resetSeconds?: number
): Promise<void> {
  if (!accountId) return;
  const wait = Math.max(SOFT_COOLDOWN_MS, (resetSeconds ?? 0) * 1000);
  const until = Date.now() + wait;

  const existing = memo.get(accountId);
  if (!existing || existing.until < until) memo.set(accountId, { until, checkedAt: Date.now() });

  await db
    .insert(metaCooldowns)
    .values({
      accountId,
      until: new Date(until),
      reason:
        `Cruise stopped calling this account on its own: Meta reported ${Math.round(percent)}% of its per-account ` +
        `allowance used. Nothing is broken and nothing was refused — this is the pause that stops a refusal.`,
      strikes: 0,
      noticedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: metaCooldowns.accountId,
      set: {
        until: sql`GREATEST(${metaCooldowns.until}, EXCLUDED.until)`,
        // A voluntary pause must not overwrite the explanation of a real one,
        // nor reset the strike count that is holding a long window open.
        reason: sql`CASE WHEN ${metaCooldowns.until} > now() THEN ${metaCooldowns.reason} ELSE EXCLUDED.reason END`,
        noticedAt: new Date(),
      },
    })
    .catch(() => {
      /* best effort — see above */
    });
}

/**
 * Milliseconds left to wait, or 0 when this account is free to call.
 *
 * Reads the shared row, through a short memo. A database failure returns 0:
 * the app should not stop talking to Meta because it could not talk to
 * Postgres, and the in-process half of the breaker still applies.
 */
export async function cooldownRemaining(accountId: string | null): Promise<number> {
  if (!accountId) return 0;
  const now = Date.now();

  const cached = memo.get(accountId);
  if (cached) {
    // A live window is authoritative without re-reading — it can only have been
    // extended, and this instance already knows to stay away.
    if (cached.until > now) return cached.until - now;
    if (now - cached.checkedAt < MEMO_MS) return 0;
  }

  try {
    const rows = await db
      .select({ until: metaCooldowns.until })
      .from(metaCooldowns)
      .where(eq(metaCooldowns.accountId, accountId))
      .limit(1);
    const until = rows[0]?.until?.getTime() ?? 0;
    memo.set(accountId, { until, checkedAt: now });
    return until > now ? until - now : 0;
  } catch {
    return 0;
  }
}

/** Let an account be called again before its window ends. */
export async function clearCooldown(accountId: string): Promise<void> {
  memo.delete(accountId);
  await db.delete(metaCooldowns).where(eq(metaCooldowns.accountId, accountId)).catch(() => {});
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
