# Deploying Cruise

Written 2026-09-17, when Cruise moved from SQLite on one laptop to Postgres on
Vercel with a team using it.

---

## 1. Create the database

Neon (<https://neon.tech>), free tier is enough to start.

Copy the **pooled** connection string — the host contains `-pooler`. The direct
one will work locally and run the database out of connections once several
serverless instances are warm.

```
postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/cruise?sslmode=require
```

Consider creating a second Neon **branch** called `staging` and using its
connection string for local development, so a mistake locally cannot touch the
data the team is using.

## 2. Generate the secrets

```bash
openssl rand -base64 32   # NEXTAUTH_SECRET
openssl rand -base64 48   # CREDENTIAL_KEY
openssl rand -hex 32      # CRON_SECRET
```

`CREDENTIAL_KEY` encrypts per-account Meta tokens. **Back it up somewhere other
than the database.** Rotating it does not lose data, but every stored
per-account token has to be re-authorised rather than recovered.

## 3. Set up the schema

Locally, with `DATABASE_URL` pointing at the new database:

```bash
npm install
npm run db:migrate      # creates every table
npm run db:seed         # demo users and demo data — see the warning below
```

`db:seed` creates the four demo logins with the password `demo1234`, and fills
the demo tables. **Before anyone else gets the URL**: change those passwords, or
delete the accounts you do not want and create real ones in Settings → Users.
A public URL with `admin@autocampaign.ai / demo1234` on it is an open door.

The seeded demo tables are withheld automatically once `USE_MOCK_META=false`,
so Reports and Leads will say so rather than showing invented figures.

## 4. Deploy

Push to GitHub, import the repository in Vercel, and set these environment
variables in the Vercel project (Production **and** Preview):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | The pooled Neon string |
| `NEXTAUTH_SECRET` | From step 2 |
| `NEXTAUTH_URL` | The deployment's own URL, e.g. `https://cruise.vercel.app` |
| `CREDENTIAL_KEY` | From step 2 |
| `CRON_SECRET` | From step 2 |
| `META_APP_ID` / `META_APP_SECRET` | From the Cruise Meta app |
| `META_ACCESS_TOKEN` | The system user token |
| `META_AD_ACCOUNT_ID` | The default ad account, digits only |
| `USE_MOCK_META` | `false` |
| `AUTO_PAUSE` | `true` to arm enforcement |

Then add the deployment's domain to the Meta app: developers.facebook.com → the
Cruise app → Settings → Basic → App Domains, and under Facebook Login → Valid
OAuth Redirect URIs if per-client OAuth is added later.

**Migrations do not run during the build.** After the first deploy, and after
any deploy that includes a new file in `drizzle/`, run:

```bash
DATABASE_URL="<the pooled string>" npm run db:migrate
```

This is deliberate: a build runs where the database may be unreachable, and a
failed migration should stop at a step that says "migration failed" rather than
one that says "build failed".

## 5. Check auto-pause is actually scheduled

`vercel.json` schedules `/api/cron/enforce` hourly. Confirm it appears under the
project's **Cron Jobs** tab after deploying — the in-process timer that worked
locally does **not** run on Vercel, so if the schedule is missing, auto-pause
silently never runs however enabled it looks in the interface.

Test it by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/cron/enforce
```

## 6. Give the team access

1. **Settings → Users** — add each person with a role.
   `ADMIN` sees and edits every account. `MANAGER` and `VIEWER` see nothing
   until granted.
2. **Settings → Ad accounts** — connect the accounts, and check each one reads
   *Full control* or *Can publish and pause*. *Reporting only* means every
   screen works and every publish fails.
3. **Settings → Account access** — grant each person the accounts they need,
   `View` or `Edit`.

The grant is enforced in the server, not the interface: a hand-edited
`?account=` pointing at an account someone has not been granted falls back to
one they have, and an unpermitted write is refused with a 403.

---

## Known limits

These are real and worth knowing before the team relies on them.

- **Bulk cities will time out on a long list.** Resolving city names against
  Meta is sequential; a file of 200 cities takes longer than a Vercel function
  is allowed to run. Split large files, or this needs a background job.
- **The Graph cache is per instance.** Every cold start begins with an empty
  cache, so Meta's per-account rate limit (code 17) is reached sooner than it
  was locally. A shared cache (Vercel KV / Upstash) is the fix when it starts
  biting.
- **Reports, Leads, `/cities/[id]` and `/campaigns/[id]`** read the demo tables.
  Reports and Leads now refuse to show them on a live install; the two detail
  screens still need cutting over to Meta.
- **Third-party accounts need partner access.** One system user token reaches
  only accounts in Girnar's own Business Manager. A client granting access to a
  personal Facebook profile does not make the account visible to Cruise — their
  Business Manager has to grant partner access to yours. Self-serve onboarding
  needs Facebook Login for Business, which needs Meta App Review; the token
  column and credential resolver are already in place for it.
