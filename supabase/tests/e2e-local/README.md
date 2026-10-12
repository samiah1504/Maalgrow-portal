# MaalRise local end-to-end test (scratch only)

Drives the real MaalRise admin screens in a browser, as each staff role,
against a **local scratch** Postgres. It never touches staging or production.

Pieces:

- `up.sh`: rebuilds the `mr_e2e` database from every migration, then adds the Supabase-like roles (`supabase_roles.sql`) and fictitious test people (`seed.sql`). It starts PostgREST and `gateway.mjs`, which imitates Supabase's `/rest/v1` and `/auth/v1/user`.
- `jwt.mjs` / `keys.mjs`: sign tokens with a throwaway local secret, so the database's own RLS and role checks decide every outcome.
- `ui-e2e.mjs`: the browser run (puppeteer-core with the preinstalled Chromium). It covers:
  - creating a Cycle; submit, return, edit and approve, with a different approver;
  - adding investors: MaalGrow KYC reuse and bank prefill; staff refused; unknown email refused; email wildcards;
  - bank confirmation, KYC record and review;
  - funding, recorded by one person and confirmed by another;
  - activation checks; activation refused until every check passes;
  - dashboard and lists;
  - payment officer and investor refusals.

Run:

```sh
PGHOST=/path/to/scratch/socket PGPORT=55432 POSTGREST=/path/to/postgrest bash supabase/tests/e2e-local/up.sh
eval "$(node supabase/tests/e2e-local/keys.mjs | sed 's/^/export /')"
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON SUPABASE_SERVICE_ROLE_KEY=$SERVICE npx next build
# start `npx next start -p 3000` with the same env, then:
node supabase/tests/e2e-local/ui-e2e.mjs /tmp/shots
```

`ui-e2e-phase4.mjs` covers Phase 4:
  - contract upload and download;
  - activation;
  - payment-date reminders and the five-day follow-up;
  - recording, confirming, part and excess payments;
  - distribution approval;
  - Mark as Paid and super-admin reversal;
  - the dashboard and refusals.

`up.sh` also emulates Supabase storage on disk for the document routes.

Rebuild the database (`up.sh`) before each run; each run creates records.
