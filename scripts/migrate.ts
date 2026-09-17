import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sslFor } from "../src/lib/db/ssl";

/**
 * Apply every migration that has not been applied yet, then stop.
 *
 * Run this against a fresh database and it builds the whole schema. Run it
 * against an up-to-date one and it does nothing. It is safe to run on every
 * deploy, which is the point — a migration step someone has to remember is a
 * migration step that gets skipped.
 *
 * Deliberately NOT part of `next build`: a build runs in an environment that
 * may not be allowed to reach the database, and a failed migration should stop
 * a deploy at a step that says "migration failed", not one that says "build
 * failed".
 */
async function main() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    console.error(
      "DATABASE_URL is not set. Put the pooled Postgres connection string in .env before running migrations."
    );
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: sslFor(connectionString),
    max: 1,
  });

  const db = drizzle(pool);
  console.log("Applying migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Database is up to date.");
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
