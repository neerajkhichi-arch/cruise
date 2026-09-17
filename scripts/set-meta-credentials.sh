#!/usr/bin/env bash
#
# Safely set META_ACCESS_TOKEN and META_APP_SECRET in .env.
#
# This exists because .env has been corrupted three times in this project:
# duplicate AUTO_PAUSE lines, a literal `tail -2 .env` pasted into the file, and
# TextEdit dropping lines on save. Each time the symptom was a confusing API
# error and each time the cause was hand-editing a file where one wrong
# character breaks everything silently.
#
# What it guarantees:
#   - The values are typed, never echoed to the screen and never passed as
#     command-line arguments (argv is visible to anyone running `ps`).
#   - Every other line of .env is preserved byte for byte.
#   - A key that already exists is REPLACED, not appended, so you cannot end up
#     with two META_ACCESS_TOKEN lines where the last one silently wins.
#   - A timestamped backup is taken before anything is written.
#   - Values containing spaces or newlines are rejected, which is what a
#     half-copied token looks like.
#
# Usage:  bash scripts/set-meta-credentials.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
  echo "No .env in $(pwd) — run this from the project and make sure .env exists." >&2
  exit 1
fi

echo "Updating META_ACCESS_TOKEN and META_APP_SECRET in $(pwd)/.env"
echo "Paste each value and press Enter. Nothing you type will be shown."
echo

# -s: no echo. -r: backslashes are literal, which matters for secrets.
read -rsp "META_ACCESS_TOKEN: " NEW_TOKEN
echo
read -rsp "META_APP_SECRET:   " NEW_SECRET
echo
echo

export NEW_TOKEN NEW_SECRET ENV_FILE

python3 - <<'PY'
import os, re, shutil, sys, time

path   = os.environ["ENV_FILE"]
values = {
    "META_ACCESS_TOKEN": os.environ["NEW_TOKEN"],
    "META_APP_SECRET":   os.environ["NEW_SECRET"],
}

# A pasted value that lost characters, or gained a newline, is the most common
# failure. Catch it here rather than as a 400 from Meta an hour later.
for key, val in values.items():
    if not val:
        sys.exit(f"{key} was empty. Nothing written.")
    if re.search(r"\s", val):
        sys.exit(f"{key} contains a space or newline, which no Meta credential does. "
                 f"That usually means the paste picked up a line break. Nothing written.")
    if len(val) < 20:
        sys.exit(f"{key} is only {len(val)} characters, which is too short to be real. "
                 f"Nothing written.")

with open(path, "r", encoding="utf-8") as f:
    lines = f.read().splitlines()

seen = {k: 0 for k in values}
out  = []
for line in lines:
    m = re.match(r"^\s*(?:export\s+)?([A-Z0-9_]+)\s*=", line)
    key = m.group(1) if m else None
    if key in values:
        seen[key] += 1
        # Replace the first occurrence; drop any later duplicates entirely,
        # since a second line for the same key silently overrides the first and
        # is never what anyone meant.
        if seen[key] == 1:
            out.append(f"{key}={values[key]}")
        continue
    out.append(line)

for key, count in seen.items():
    if count == 0:
        out.append(f"{key}={values[key]}")

backup = f"{path}.bak.{time.strftime('%Y%m%d-%H%M%S')}"
shutil.copy2(path, backup)

with open(path, "w", encoding="utf-8") as f:
    f.write("\n".join(out) + "\n")

print(f"Backup written to {backup}")
for key, count in seen.items():
    if count == 0:
        print(f"  {key}: added (was not present)")
    elif count == 1:
        print(f"  {key}: replaced")
    else:
        print(f"  {key}: replaced, and {count - 1} duplicate line(s) removed")
print(f"{path} now has {len(out)} lines.")
PY

unset NEW_TOKEN NEW_SECRET

echo
echo "Done. Restart the dev server for this to take effect."
