"use client";

import { useState } from "react";
import { CheckCircle2, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, formatDateTime } from "@/lib/utils";
import { formatKobo } from "@/lib/maalrise/format";
import { useMaalriseAction } from "@/components/maalrise/use-maalrise-action";

export type QueueItem = {
  id: string;
  kind: "profit" | "capital";
  label: string;
  investorName: string;
  investorCode: string;
  cycleName: string | null;
  amountKobo: number;
  bankName: string | null;
  accountName: string | null;
  accountNumber: string | null;
  status: "payable" | "paid";
  paidOn: string | null;
  paidReference: string | null;
  history: { id: string; event: "marked_paid" | "reversed"; paidOn: string | null; reference: string | null; reason: string | null; at: string }[];
};

export function PaymentQueue({ items, today, canReverse }: { items: QueueItem[]; today: string; canReverse: boolean }) {
  const [tab, setTab] = useState<"payable" | "paid">(items.some((i) => i.status === "payable") ? "payable" : "paid");
  const shown = items.filter((i) => i.status === tab);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["payable", "paid"] as const).map((t) => (
          <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>
            {t === "payable" ? `To pay (${items.filter((i) => i.status === "payable").length})` : `Paid (${items.filter((i) => i.status === "paid").length})`}
          </Button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">{tab === "payable" ? "Nothing waiting to be paid." : "No payments recorded yet."}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-3 py-2 font-medium">Investor</th>
                <th className="px-3 py-2 font-medium">Cycle / payment</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Pay to</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((i) => <Row key={i.id} item={i} today={today} canReverse={canReverse} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ item: i, today, canReverse }: { item: QueueItem; today: string; canReverse: boolean }) {
  const { run, busy } = useMaalriseAction();
  const [paying, setPaying] = useState(false);
  const [paidOn, setPaidOn] = useState(today);
  const [reference, setReference] = useState("");
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState("");
  const url = `/api/admin/maalrise/payments/${i.id}`;

  return (
    <tr className="align-top">
      <td className="px-3 py-2">{i.investorName} <span className="block text-xs font-mono text-muted">{i.investorCode}</span></td>
      <td className="px-3 py-2">{i.cycleName ?? "MaalRise"} <span className={`block text-xs ${i.kind === "capital" ? "font-medium text-primary-700" : "text-muted"}`}>{i.label}</span></td>
      <td className="px-3 py-2 text-right font-semibold">{formatKobo(i.amountKobo)}</td>
      <td className="px-3 py-2 text-xs">
        {i.bankName}<br />{i.accountName}<br /><span className="font-mono text-sm">{i.accountNumber}</span>
      </td>
      <td className="px-3 py-2">
        {i.status === "paid" ? (
          <>
            <Badge variant="approved"><CheckCircle2 className="mr-1 h-3 w-3" />Paid</Badge>
            <p className="text-[11px] text-muted mt-0.5">{`${formatDate(i.paidOn!)}${i.paidReference ? ` · ref ${i.paidReference}` : ""}`}</p>
          </>
        ) : (
          <Badge variant="warning">Approved — to pay</Badge>
        )}
        {i.history.some((h) => h.event === "reversed") && (
          <ul className="mt-1 space-y-0.5 text-[11px] text-muted">
            {i.history.map((h) => (
              <li key={h.id}>
                {h.event === "reversed" ? `Reversed ${formatDateTime(h.at)}: ${h.reason}` : `Marked paid ${h.paidOn ? formatDate(h.paidOn) : ""}${h.reference ? ` (ref ${h.reference})` : ""}`}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {i.status === "payable" && !paying && (
          <Button size="xs" onClick={() => setPaying(true)}>Mark as Paid</Button>
        )}
        {i.status === "payable" && paying && (
          <div className="ml-auto w-56 space-y-2 text-left">
            <Input label="Transfer date" type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            <Input label="Transfer reference" value={reference} onChange={(e) => setReference(e.target.value)} hint="From the bank, where available" />
            <div className="flex gap-1">
              <Button size="xs" disabled={!paidOn} loading={busy === "pay"}
                onClick={async () => {
                  if (await run("pay", url, { action: "mark_paid", paid_on: paidOn, reference, kind: i.kind }, { success: `${i.investorName} marked paid.` })) setPaying(false);
                }}>
                Confirm transfer made
              </Button>
              <Button size="xs" variant="outline" onClick={() => setPaying(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {i.status === "paid" && canReverse && !reversing && (
          <Button size="xs" variant="outline" onClick={() => setReversing(true)}><Undo2 className="h-3 w-3" /> Reverse</Button>
        )}
        {i.status === "paid" && canReverse && reversing && (
          <div className="ml-auto w-56 space-y-2 text-left">
            <Input label="Reason for reversal" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-1">
              <Button size="xs" variant="destructive" disabled={!reason.trim()} loading={busy === "reverse"}
                onClick={async () => {
                  if (await run("reverse", url, { action: "reverse", reason, kind: i.kind }, { success: "Payment reversed — it is payable again. The history keeps both records." })) {
                    setReversing(false); setReason("");
                  }
                }}>
                Reverse payment
              </Button>
              <Button size="xs" variant="outline" onClick={() => setReversing(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}
