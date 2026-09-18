import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as readline from "readline";
import { users } from "../src/lib/db/schema";
import { sslFor } from "../src/lib/db/ssl";
import { checkPassword, generatePassword } from "../src/lib/password";

/**
 * Set a password from the command line.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Cruise has no password-reset email and no recovery question. That is a
 * reasonable thing for a small internal tool — until the only admin cannot
 * sign in, at which point nobody can administer anything and there is no way
 * back in through the interface at all. Locked out is locked out.
 *
 * This is the way back: whoever holds DATABASE_URL can set any password. That
 * is deliberately a high bar — it means access to the production connection
 * string — and it is the same bar as "can read the whole database anyway", so
 * it grants nothing that was not already implied.
 *
 * The password is read from a prompt with echo off, never from an argument:
 * arguments land in the shell history, the process list and, on macOS, the
 * Terminal window title. That last one has already leaked a secret once in
 * this project.
 *
 * USAGE
 *   npx tsx scripts/set-password.ts someone@example.com
 *   npx tsx scripts/set-password.ts someone@example.com --generate
 *   npx tsx scripts/set-password.ts --list
 * ---------------------------------------------------------------------------
 */

function ask(question: string, hidden: boolean): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      // Suppress echo: write the prompt once, then swallow what the terminal
      // would otherwise print back.
      const asAny = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
      let first = true;
      asAny._writeToOutput = function (s: string) {
        if (first) {
          asAny.output.write(s);
          first = false;
        }
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    console.error("DATABASE_URL is not set. This must run against the database you want to change.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString, ssl: sslFor(connectionString), max: 1 });
  const db = drizzle(pool, { schema: { users } });

  const args = process.argv.slice(2);
  const wantsList = args.includes("--list");
  const wantsGenerated = args.includes("--generate");
  const email = args.find((a) => !a.startsWith("--"))?.toLowerCase();

  // --- who is in there ------------------------------------------------------
  if (wantsList || !email) {
    const rows = await db.select({ email: users.email, name: users.name, role: users.role }).from(users);
    if (rows.length === 0) {
      console.log("\nThere are no users in this database at all. Run `npm run db:seed` to create some.\n");
    } else {
      console.log("\nUsers in this database:\n");
      for (const r of rows) console.log(`  ${r.role.padEnd(8)} ${r.email.padEnd(34)} ${r.name}`);
      console.log("\nSet one's password with:  npx tsx scripts/set-password.ts <email>\n");
    }
    await pool.end();
    return;
  }

  const target = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (target.length === 0) {
    console.error(`\nNo user with the email ${email}. Run with --list to see who exists.\n`);
    await pool.end();
    process.exit(1);
  }

  // --- the new password -----------------------------------------------------
  let password: string;
  if (wantsGenerated) {
    password = generatePassword();
  } else {
    password = await ask(`New password for ${email} (not shown as you type): `, true);
    const again = await ask("Again: ", true);
    if (password !== again) {
      console.error("\nThose did not match. Nothing was changed.\n");
      await pool.end();
      process.exit(1);
    }
    const verdict = checkPassword(password, email);
    if (!verdict.ok) {
      console.error(`\n${verdict.reason}\nNothing was changed.\n`);
      await pool.end();
      process.exit(1);
    }
  }

  await db
    .update(users)
    .set({ passwordHash: await bcrypt.hash(password, 12) })
    .where(eq(users.email, email));

  console.log(`\n  Password set for ${email} (${target[0].name}, ${target[0].role}).`);
  if (wantsGenerated) console.log(`  It is:  ${password}\n  Copy it now — it is not stored anywhere in readable form.`);
  console.log("");

  await pool.end();
}

main().catch(async (err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
