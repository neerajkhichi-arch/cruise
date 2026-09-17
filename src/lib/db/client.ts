import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { sslFor } from "./ssl";

/**
 * The database connection.
 *
 * PostgreSQL, over the standard protocol via node-postgres. That choice is
 * deliberate over Neon's HTTP driver: it is the same code path locally and on
 * Vercel, it supports transactions, and it works against any Postgres if this
 * ever moves off Neon. Neon is reached through its POOLED connection string —
 * the one with `-pooler` in the host — because a serverless function that
 * opens a direct connection per invocation exhausts the connection limit long
 * before it exhausts anything else.
 *
 * The pool is cached on globalThis. In development Next.js reloads modules on
 * every edit, and without this each reload would leak a pool until Postgres
 * refused new connections. In production on Vercel it keeps one pool per warm
 * instance instead of one per request.
 */

const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  // Failing loudly here beats failing obscurely inside the first query, and
  // beats silently falling back to a local file that will not exist in
  // production — which is precisely how the old SQLite build would have
  // "worked" on Vercel while losing every write.
  throw new Error(
    "DATABASE_URL is not set. Cruise needs a PostgreSQL connection string — " +
      "use the pooled one from Neon (the host contains `-pooler`). " +
      "Set it in .env locally and in the Vercel project's environment variables."
  );
}

const globalForDb = globalThis as unknown as { cruisePool?: Pool };

const pool =
  globalForDb.cruisePool ??
  new Pool({
    connectionString,
    // Verified TLS by default — see lib/db/ssl.ts for why that is not the
    // usual copy-pasted `rejectUnauthorized: false`.
    ssl: sslFor(connectionString),
    // A serverless instance handles a handful of concurrent queries at most.
    // A large pool per instance multiplied by many instances is how a database
    // runs out of connections while barely doing any work.
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== "production") globalForDb.cruisePool = pool;

// An idle client erroring must not take the process down. Postgres closes idle
// connections and the pool will make another; an unhandled 'error' event here
// would crash the server instead.
pool.on("error", (err) => {
  console.error("[db] idle client error:", err.message);
});

export const db = drizzle(pool, { schema });
export { pool };
