import Link from "next/link";
import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "MaalRise Guide | Admin" };

type Step = { who: string; what: React.ReactNode };
const STAGES: { title: string; steps: Step[] }[] = [
  {
    title: "1. Add the investors",
    steps: [
      { who: "Operations / Administrator", what: <>MaalRise Investors → <Link href="/admin/maalrise/investors/new">Add Investor</Link>. An existing MaalGrow investor keeps their login; a new person gets a login. Nothing is emailed.</> },
      { who: "Super admin / Administrator", what: <>On the investor&apos;s page press <strong>Send invitation</strong>. They set a password and complete the same KYC form as MaalGrow.</> },
      { who: "KYC reviewer", what: <>Review the form in <Link href="/admin/kyc">KYC Review</Link>. Approval is carried to MaalRise automatically.</> },
      { who: "Operations / Administrator", what: "Confirm the investor's bank details on their MaalRise page. Payments only go to confirmed accounts." },
    ],
  },
  {
    title: "2. Set up and activate a Cycle",
    steps: [
      { who: "Operations / Administrator", what: <><Link href="/admin/maalrise/cycles/new">New Cycle</Link>: counterparty, dates, unit price and terms (total markup for the whole Cycle, service fee). Submit the terms.</> },
      { who: "A second Administrator / Super admin", what: "Approve the terms. The person who prepared or submitted them cannot approve — except a super admin, who may approve their own terms by giving a reason (kept in the audit log)." },
      { who: "Finance", what: "Record each investor's funding (units, amount, date, reference)." },
      { who: "Super admin / Administrator", what: <>Many investors at once: on the Cycle (section 4) use <strong>Import many investors at once</strong> with a Google Sheet link or a CSV/Excel file (download the template there: Full name, Email, Phone, Units, Date received). Check the rows, then import: people are added (new logins, nothing sent) and their funding is recorded. Bank details are not imported — investors give them on the KYC form. Importing the same sheet again adds nothing.</> },
      { who: "Finance / Super admin / Administrator", what: <>Confirm the funding — one by one, or all at once with <strong>Confirm all</strong> (someone other than the person who recorded it — or a super admin, giving one reason); upload the signed contract; run the activation checks; Activate.</> },
      { who: "Super admin / Administrator", what: <>Once funding is confirmed, press <strong>Email all investors</strong> on the Cycle: you see how many invitations (people who never signed in — they set a password, then fill the KYC form) and notifications (people who already sign in) will go, then one press sends them. Each investor gets it once per Cycle; failed ones can be retried. To email all MaalRise investors at any time, use the Communication Centre.</> },
    ],
  },
  {
    title: "3. Every month",
    steps: [
      { who: "Finance / Administrator", what: "On the payment date you get an alert. When the counterparty's payment arrives, record it on the Cycle (amount, actual date, reference). Five days late → a follow-up alert." },
      { who: "Administrator / Super admin", what: "Confirm the payment. The month's distribution is calculated: fee, each investor's share to the kobo, the unsubscribed share left unallocated." },
      { who: "Administrator / Super admin", what: "Review and approve the distribution." },
      { who: "Payment officer", what: <>Make the bank transfers, then in <Link href="/admin/payment-requests/maalrise">MaalRise Payments</Link> mark each one paid with the date and reference. The investor then sees <strong>Paid</strong>.</> },
      { who: "Super admin / Administrator", what: <>In <Link href="/admin/maalrise/emails">MaalRise Emails</Link>, send the &quot;payment sent&quot; emails (or discard them).</> },
    ],
  },
  {
    title: "4. At maturity and closing",
    steps: [
      { who: "Finance / Administrator", what: "Record the capital repayment (it may arrive in parts; never more than is owed)." },
      { who: "Administrator / Super admin", what: "Confirm it. Once the full capital is confirmed, the capital settlement is prepared — approve it." },
      { who: "Payment officer", what: "Transfer each investor's capital and mark it paid." },
      { who: "Administrator / Super admin", what: "Run the closing checks and Close the Cycle. A closed Cycle is final." },
    ],
  },
  {
    title: "5. Corrections",
    steps: [
      { who: "Administrator / Super admin", what: "A wrong entry not yet confirmed: Reject it with a reason." },
      { who: "Super admin", what: "A wrong confirmed entry, before its distribution or settlement is approved: Reverse it with a reason. A payment marked paid by mistake: Reverse it with a reason." },
      { who: "Operations / Administrator", what: "An investor's bank change request: Approve or Reject (with a reason) on their page." },
    ],
  },
  {
    title: "6. Reporting and messages",
    steps: [
      { who: "Finance / Accountant", what: <><Link href="/admin/maalrise/reports">MaalRise Reports</Link>: the month&apos;s payments register (reconcile with the bank statement), and each Cycle&apos;s report, investor CSV and audit trail.</> },
      { who: "Super admin / Administrator", what: <>To message MaalRise investors, use the <Link href="/admin/comms">Communication Centre</Link> → Individual Investors → MaalRise investors (all, or one Cycle).</> },
    ],
  },
];

export default async function MaalRiseGuidePage() {
  await requireAdminPage();
  return (
    <div className="max-w-4xl space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">MaalRise Guide</h1>
        <p className="text-sm text-muted mt-1">
          Who does what, from adding investors to closing a Cycle. The system enforces each rule — if a step is refused,
          the message says why.
        </p>
      </div>
      {STAGES.map((s) => (
        <Card key={s.title}>
          <CardHeader><CardTitle className="text-base">{s.title}</CardTitle></CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm">
              {s.steps.map((st, i) => (
                <li key={i} className="grid gap-1 sm:grid-cols-[14rem_1fr]">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gold-700">{st.who}</span>
                  <span className="text-foreground [&_a]:text-primary-700 [&_a]:underline">{st.what}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ))}
      <p className="text-xs text-muted">
        Emails are only ever sent when someone presses Send. Tax is not deducted (not configured).
      </p>
    </div>
  );
}
