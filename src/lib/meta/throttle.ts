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

/** How long to leave an account alone after it reports a rate limit. */
const COOLDOWN_MS = 5 * 60 * 1000;

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
 * Synchronous by signature, because it is called from the Graph error path,
 * which cannot await. Memory is updated at once so THIS instance stops
 * immediately; the shared write follows and is allowed to fail — losing it
 * costs one instance's worth of extra calls, while throwing here would replace
 * a rate-limit error with a database error and hide what actually happened.
 */
export function noteRateLimited(accountId: string | null, reason?: string): void {
  if (!accountId) return;
  const until = Date.now() + COOLDOWN_MS;
  memo.set(accountId, { until, checkedAt: Date.now() });

  void db
    .insert(metaCooldowns)
    .values({ accountId, until: new Date(until), reason: reason ?? null, noticedAt: new Date() })
    .onConflictDoUpdate({
      target: metaCooldowns.accountId,
      // Extend, never shorten: a second rate limit while cooling off means the
      // account needs longer, not that the clock restarts shorter.
      set: {
        until: sql`GREATEST(${metaCooldowns.until}, EXCLUDED.until)`,
        reason: reason ?? null,
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
