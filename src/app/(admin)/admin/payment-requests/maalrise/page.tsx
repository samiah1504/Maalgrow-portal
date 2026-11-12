import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, PauseCircle } from "lucide-react";
import { formatKobo } from "@/lib/maalrise/format";
import { listCapitalQueue, listMyNotifications, listPaymentQueue, mr } from "@/lib/maalrise/db";
import { requireMaalrisePaymentsPage } from "@/lib/maalrise/page-guard";
import { lagosToday } from "@/lib/maalrise/receipts";
import { EmptyState } from "@/components/maalrise/sample-notice";
import { PaymentQueue } from "./_payment-queue";
import { NotificationList } from "@/components/maalrise/notification-list";

export const metadata: Metadata = { title: "MaalRise Payments | Admin" };

/**
 * Approved MaalRise investor payments. The transfer is made in the
 * bank, outside the system; this screen records that it was made.
 * "Paid" is stored once, on the payment line, and every screen —
 * this one, the Cycle page and (Phase 6) the investor portal — reads
 * that same status.
 */
export default async function MaalRisePaymentsPage() {
  const { supabase, role } = await requireMaalrisePaymentsPage();
  const db = mr(supabase);
  const [profit, capital, notes] = await Promise.all([listPaymentQueue(db), listCapitalQueue(db), listMyNotifications(db, 10)]);
  const items = [
    ...profit.map((i) => ({ ...i, cycleName: i.distribution?.cycle_name ?? null, label: `Profit · month ${i.period}` })),
    ...capital.map((i) => ({ ...i, cycleName: i.settlement?.cycle_name ?? null, label: "Capital repayment" })),
  ];
  const held = items.filter((i) => i.status === "on_hold");
  const toPay = items.filter((i) => i.status === "payable");
  const paid = items.filter((i) => i.status === "paid");
  const unread = notes.filter((n) => !n.read_at);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">MaalRise Payments</h1>
        <p className="text-sm text-muted mt-1">
          Approved monthly profit payments and capital repayments to MaalRise investors. Make each transfer in the bank, then mark it paid here.
          Nothing is paid automatically.
        </p>
      </div>

      {unread.length > 0 && <NotificationList items={unread} compact />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-white p-4">
          <p className="text-xs text-muted">To pay</p>
          <p className="text-xl font-bold">{formatKobo(toPay.reduce((s, i) => s + i.amount_kobo, 0))}</p>
          <p className="text-xs text-muted">{`${toPay.length} payment(s)`}</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-4">
          <p className="text-xs text-muted">Paid</p>
          <p className="text-xl font-bold text-emerald-700">{formatKobo(paid.reduce((s, i) => s + i.amount_kobo, 0))}</p>
          <p className="text-xs text-muted">{`${paid.length} payment(s)`}</p>
        </div>
      </div>

      {held.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-2" data-testid="held-payments">
          <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
            <PauseCircle className="h-4 w-4" /> On hold — waiting for confirmed bank details ({held.length}, {formatKobo(held.reduce((s, i) => s + i.amount_kobo, 0))})
          </p>
          <p className="text-xs text-amber-900">
            Approved, but these investors have no confirmed bank details yet. Each is released here automatically, ready to pay, the moment
            their bank details are confirmed — on their MaalRise page, by a bank-change approval, or by approving their KYC in MaalGrow.
          </p>
          <ul className="divide-y divide-amber-200 text-sm">
            {held.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>
                  <Link href={`/admin/maalrise/investors/${i.maalrise_investor_id}`} className="font-medium text-primary-700 hover:underline">{i.investor_name}</Link>
                  <span className="text-xs text-muted"> · {i.label}{i.cycleName ? ` · ${i.cycleName}` : ""}</span>
                </span>
                <span className="font-medium">{formatKobo(i.amount_kobo)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {items.length - held.length === 0 ? (
        held.length > 0 ? null :
        <EmptyState icon={<Banknote className="h-5 w-5" />} title="No approved MaalRise payments">
          Payments appear here once an administrator approves a monthly profit distribution or a capital settlement.
        </EmptyState>
      ) : (
        <PaymentQueue
          items={items.filter((i) => i.status !== "on_hold").map((i) => ({
            id: i.id,
            kind: i.kind,
            label: i.label,
            investorName: i.investor_name,
            investorCode: i.investor_code,
            cycleName: i.cycleName,
            amountKobo: i.amount_kobo,
            bankName: i.bank_name,
            accountName: i.account_name,
            accountNumber: i.account_number,
            status: i.status as "payable" | "paid",
            paidOn: i.paid_on,
            paidReference: i.paid_reference,
            history: i.history.map((h) => ({ id: h.id, event: h.event, paidOn: h.paid_on, reference: h.reference, reason: h.reason, at: h.created_at })),
          }))}
          today={lagosToday()}
          canReverse={role === "super_admin"}
        />
      )}
    </div>
  );
}
