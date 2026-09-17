import { randomBytes } from "crypto";

/**
 * Password rules, and a generator for temporary ones.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Until now Cruise had no way to change a password at all — the only admin
 * endpoint changed a ROLE — and every user created through the interface was
 * given the hardcoded string "demo1234", the same one the seed script uses and
 * the same one written in the README that sits in a public-until-yesterday
 * GitHub repo.
 *
 * That is not a weak default. It is a published credential on an install that
 * can spend money in five live ad accounts. Adding a colleague would have
 * created another account with the same password.
 * ---------------------------------------------------------------------------
 */

const MIN_LENGTH = 12;

/**
 * Passwords that are common enough to be tried first by anyone who bothers,
 * plus the ones this codebase itself has used.
 */
const REFUSED = new Set([
  "demo1234",
  "demo12345",
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "qwerty123",
  "letmein123",
  "changeme123",
  "cruise1234",
  "admin1234",
]);

export interface PasswordCheck {
  ok: boolean;
  reason?: string;
}

export function checkPassword(password: string, email?: string): PasswordCheck {
  const p = (password ?? "").trim();

  if (p.length < MIN_LENGTH) {
    return { ok: false, reason: `Use at least ${MIN_LENGTH} characters. Length matters more than punctuation.` };
  }
  if (REFUSED.has(p.toLowerCase())) {
    return { ok: false, reason: "That is one of the first passwords anyone would try. Pick something else." };
  }
  // A password containing the local part of the email is guessable by anyone
  // who has the email — which, for a work tool, is everyone.
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && p.toLowerCase().includes(local)) {
    return { ok: false, reason: "Do not use part of the email address in the password." };
  }
  if (/^(.)\1+$/.test(p)) {
    return { ok: false, reason: "That is a single repeated character." };
  }
  return { ok: true };
}

/**
 * A temporary password to hand to a new colleague.
 *
 * Deliberately generated rather than defaulted: a default is the same for
 * everyone and ends up written down somewhere public, which is exactly the
 * situation this replaces. Shown to the admin once, at creation, and never
 * retrievable afterwards — if it is lost, reset it rather than looking it up.
 */
export function generatePassword(): string {
  // No look-alike characters: someone is going to read this over a phone.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(20);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 15)}-${out.slice(15, 20)}`;
}
