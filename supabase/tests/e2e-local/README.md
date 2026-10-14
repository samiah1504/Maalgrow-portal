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

`ui-e2e-phase5.mjs` covers Phase 5:
  - capital reminders at maturity;
  - super-admin reversal of a confirmed entry;
  - capital recorded in parts, never above what is owed, paid out only when complete;
  - capital entry reversal;
  - settlement approval and capital Mark as Paid;
  - closing checks and closing, and a closed Cycle being final.

`ui-e2e-phase6.mjs` covers Phase 6 (the investor portal):
  - the MaalGrow | MaalRise switch for an investor in both products;
  - the overview, a Cycle's months and capital, payments, statement and CSV;
  - a MaalRise-only investor; a MaalGrow-only investor seeing no change;
  - bank detail change requests: submit, withdraw, approve, reject with a reason;
  - investors reading nothing of a Cycle's terms directly; staff and investor routes kept apart.

`ui-e2e-phase7.mjs` covers Phase 7 (go-live readiness):
  - creating a MaalRise-only investor (login and investor record, nothing sent); MaalGrow totals unchanged;
  - the invitation, the KYC form on first sign-in, KYC approval carried to MaalRise;
  - the email outbox: send, refused address kept as failed, discard, Send all; roles;
  - the Communication Centre MaalRise selection; reports and CSVs; the guide.

`up.sh` also emulates Supabase storage on disk for the document routes, account creation
(`/auth/v1/admin`, never emails) and Resend's `POST /emails` (start the app with
`RESEND_API_KEY=e2e-local RESEND_BASE_URL=http://127.0.0.1:54321`): emails are written to
`sent-emails.jsonl`, never sent; an address containing "bounce" is refused.

Rebuild the database (`up.sh`) before each run; each run creates records.

`ui-e2e-bulk.mjs` covers migration 057 and the bulk tools:
  - importing a Cycle's investors and funding from a file: preview, refused rows, new logins with nothing sent, a repeat import adds nothing;
  - Confirm all, including an administrator's own entry being left and a super admin's single reason;
  - "Email all investors in this Cycle": counts first, invitations with a set-password link for people who never signed in, notifications for the rest, one email each, the failed one retried without duplicates.
