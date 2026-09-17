import "dotenv/config";
import type { Config } from "drizzle-kit";

/**
 * Migrations are generated as files and committed, not pushed.
 *
 * `drizzle-kit push` diffs the schema against a live database and applies
 * whatever it decides — fine against a local file nobody else uses, and not
 * fine against a database a team shares. `generate` produces a reviewable SQL
 * file; `migrate` applies exactly what was reviewed, in order, once.
 */
export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
} satisfies Config;
