import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

/**
 * Encrypting the things that must not sit in the database in the clear.
 *
 * Today that is one thing: a per-account Meta access token. A token is a
 * bearer credential — whoever holds it can spend money in that ad account —
 * and a database backup, a support query or a stray SELECT should not hand one
 * over.
 *
 * AES-256-GCM, so the ciphertext is authenticated: tampering is detected on
 * decryption rather than producing a plausible wrong answer. The key comes from
 * CREDENTIAL_KEY and is never stored with the data it protects; rotating it
 * invalidates every stored token, which is the correct behaviour — a token you
 * can no longer decrypt has to be re-authorised, not guessed at.
 *
 * The stored form is `v1.<iv>.<authTag>.<ciphertext>`, all base64url. The
 * version prefix exists so that a future change of algorithm can read old rows
 * instead of orphaning them.
 */

const VERSION = "v1";

function key(): Buffer {
  const secret = process.env.CREDENTIAL_KEY?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "CREDENTIAL_KEY is missing or too short. It must be at least 32 characters and is required before Cruise " +
        "will store a per-account access token. Generate one with: openssl rand -base64 48"
    );
  }
  // A fixed salt is acceptable here because the secret is already high-entropy
  // and per-install; the purpose of scrypt is to turn an arbitrary-length
  // secret into a 32-byte key, not to defend a low-entropy password.
  return scryptSync(secret, "cruise-credential-v1", 32);
}

/** True when a token can be stored at all — checked before offering the option. */
export function encryptionAvailable(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(stored: string): string {
  const [version, ivB64, tagB64, dataB64] = stored.split(".");
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Stored credential is not in a format this version can read.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
