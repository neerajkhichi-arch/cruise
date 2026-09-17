import type { ConnectionOptions } from "tls";

/**
 * TLS settings for the database connection.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT `rejectUnauthorized: false`
 *
 * It was, for about an hour. That is the setting every hosted-Postgres snippet
 * on the internet uses, and it means: encrypt the connection, then accept
 * whatever certificate is on the other end. It stops passive eavesdropping and
 * does nothing at all against an active attacker who can answer in the
 * database's place — at which point they have every campaign, every user row
 * and the encrypted tokens.
 *
 * Neon presents a certificate from a publicly trusted CA, so there is nothing
 * to gain by not checking it. Verification is the default here, and turning it
 * off is a deliberate act with a name: DATABASE_SSL_NO_VERIFY=true, for a
 * self-signed certificate on an internal Postgres.
 *
 * node-postgres also prints a warning when the URL says `sslmode=require`,
 * because in its next major that will stop meaning "verify". Since the
 * verification decision is made here rather than from the URL, the warning is
 * advisory — but writing `sslmode=verify-full` in DATABASE_URL states the
 * intent and silences it.
 * ---------------------------------------------------------------------------
 */
export function sslFor(connectionString: string): ConnectionOptions | undefined {
  // A local Postgres over a unix socket or plain TCP has no TLS to configure.
  if (/sslmode=disable/.test(connectionString)) return undefined;
  if (!/sslmode=/.test(connectionString)) return undefined;

  if (process.env.DATABASE_SSL_NO_VERIFY === "true") {
    console.warn(
      "[db] certificate verification is OFF (DATABASE_SSL_NO_VERIFY=true). The connection is encrypted but " +
        "not authenticated. Only appropriate for a self-signed certificate on a network you control."
    );
    return { rejectUnauthorized: false };
  }

  return { rejectUnauthorized: true };
}
