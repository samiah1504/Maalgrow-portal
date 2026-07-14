"use client";

import { useState, useEffect } from "react";
import { CheckCircle2, XCircle, Clock, CreditCard, ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/types/database.types";

type PaymentRequestUpdate = Database["public"]["Tables"]["payment_requests"]["Update"];
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface PaymentRequest {
  id: string;
  request_code: string;
  type: string;
  amount: number;
  status: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  notes: string | null;
  rejection_reason: string | null;
  created_at: string;
  paid_at: string | null;
  investor: { full_name: string; investor_code: string } | null;
  investment: { investment_code: string; series: { name: string } | null } | null;
}

type FilterStatus = "pending" | "approved" | "processing" | "paid" | "rejected" | "all";

const TABS: { label: string; value: FilterStatus }[] = [
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Processing", value: "processing" },
  { label: "Paid", value: "paid" },
  { label: "Rejected", value: "rejected" },
  { label: "All", value: "all" },
];

export default function PaymentRequestsAdminPage() {
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterStatus>("pending");
  const [selected, setSelected] = useState<PaymentRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [processing, setProcessing] = useState(false);

  const supabase = createClient();

  const load = async () => {
    let query = supabase
      .from("payment_requests")
      .select("*, investor:investors(full_name, investor_code), investment:investments(investment_code, series:series(name))")
      .order("created_at", { ascending: true });

    if (activeTab !== "all") {
      query = query.eq("status", activeTab);
    }

    const { data } = await query;
    setRequests((data as unknown as PaymentRequest[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeTab]);

  const updateStatus = async (id: string, status: string, reason?: string) => {
    setProcessing(true);
    const userId = (await supabase.auth.getUser()).data.user?.id;

    const updates: PaymentRequestUpdate = {
      status: status as PaymentRequestUpdate["status"],
      reviewed_by: userId ?? null,
      reviewed_at: new Date().toISOString(),
      ...(reason && { rejection_reason: reason }),
      ...(status === "paid" && { paid_at: new Date().toISOString() }),
    };

    const { error } = await supabase
      .from("payment_requests")
      .update(updates)
      .eq("id", id);

    setProcessing(false);
    if (error) { toast.error("Failed to update payment request"); return; }

    toast.success(`Payment request ${status}`);
    setSelected(null);
    setRejectionReason("");
    load();
  };

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Payment Requests</h1>
        <p className="text-sm text-muted mt-1">
          Review and approve investor payment requests
          {pendingCount > 0 && activeTab !== "pending" && (
            <span className="ml-2 inline-flex h-5 items-center justify-center rounded-full bg-gold-500 px-2 text-[10px] font-bold text-primary-900">
              {pendingCount} pending
            </span>
          )}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-border pb-0">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`flex-shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.value
                ? "border-primary-600 text-primary-700"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-surface-2 animate-pulse" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <CreditCard className="h-12 w-12 text-border mb-4" />
            <p className="font-semibold text-foreground">No {activeTab !== "all" ? activeTab : ""} requests</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <div
              key={req.id}
              className="rounded-xl border border-border bg-surface p-4 hover:border-primary-200 transition-colors"
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${
                      req.type === "roi" ? "bg-gold-100 text-gold-700" : "bg-primary-100 text-primary-700"
                    }`}>
                      {req.type === "roi" ? "R" : "C"}
                    </span>
                    <span className="font-semibold capitalize">{req.type} Payment</span>
                    <span className="font-mono text-xs text-muted">{req.request_code}</span>
                    <Badge variant={req.status as "pending" | "approved" | "processing" | "paid" | "rejected"}>
                      {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted">
                    <div>
                      <span className="font-medium text-foreground">{req.investor?.full_name}</span>
                      <span className="ml-1">({req.investor?.investor_code})</span>
                    </div>
                    <div>Investment: <span className="font-medium text-foreground">{req.investment?.investment_code}</span></div>
                    <div>Bank: <span className="font-medium text-foreground">{req.bank_name}</span></div>
                    <div>Account: <span className="font-medium text-foreground">{req.account_number}</span></div>
                    <div>Account Name: <span className="font-medium text-foreground">{req.account_name}</span></div>
                    <div>Requested: <span className="font-medium text-foreground">{formatDate(req.created_at)}</span></div>
                  </div>

                  {req.notes && (
                    <p className="text-xs text-muted italic">{req.notes}</p>
                  )}
                  {req.rejection_reason && (
                    <p className="text-xs text-danger">Rejected: {req.rejection_reason}</p>
                  )}
                </div>

                <div className="flex items-center gap-3 sm:flex-col sm:items-end">
                  <p className="text-xl font-bold text-foreground">{formatCurrency(req.amount)}</p>
                  {req.status === "pending" && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="subtle"
                        className="text-success bg-emerald-50 hover:bg-emerald-100 border border-emerald-200"
                        onClick={() => updateStatus(req.id, "approved")}
                        disabled={processing}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="subtle"
                        className="text-danger bg-red-50 hover:bg-red-100 border border-red-200"
                        onClick={() => setSelected(req)}
                        disabled={processing}
                      >
                        <XCircle className="h-4 w-4" />
                        Reject
                      </Button>
                    </div>
                  )}
                  {req.status === "approved" && (
                    <Button
                      size="sm"
                      onClick={() => updateStatus(req.id, "paid")}
                      disabled={processing}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Mark as Paid
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rejection Dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Payment Request</DialogTitle>
            <DialogDescription>
              Provide a reason for rejecting this payment request. The investor will be notified.
            </DialogDescription>
          </DialogHeader>
          <div className="p-6">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">Rejection Reason *</label>
              <textarea
                rows={3}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g. Incorrect account details, documentation required..."
                className="flex w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSelected(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!rejectionReason.trim() || processing}
              loading={processing}
              onClick={() => selected && updateStatus(selected.id, "rejected", rejectionReason)}
            >
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
