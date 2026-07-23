"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Send,
  Save,
  Users,
  Layers,
  UserSearch,
  MessageSquare,
  Smartphone,
  Copy,
  Archive,
  Pencil,
  Plus,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { smsUnits, TEMPLATE_VARIABLES } from "@/lib/comms/util";

// ─── Types ───────────────────────────────────────────────────────────

type SeriesOption = {
  id: string;
  name: string;
  cycle_label: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  investors: number;
};

type Template = {
  id: string;
  name: string;
  channel: string;
  body: string;
  whatsapp_template_code: string | null;
  header_media_url: string | null;
  is_builtin: boolean;
  status: string;
};

type Campaign = {
  id: string;
  name: string;
  channel: string;
  recipient_group: string;
  status: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  estimated_units: number;
  estimated_cost: number;
  created_at: string;
  series: { name: string } | null;
  creator: { full_name: string | null; email: string } | null;
};

type PreviewRecipient = {
  investor_id: string;
  full_name: string;
  investor_code: string;
  email: string;
  phone_raw: string | null;
  phone_normalized: string | null;
  preferred_channel: string;
  skip_reason: string | null;
  sample_vars: Record<string, string | undefined>;
};

type Group = "all_active" | "series" | "individual";
type Channel = "sms" | "whatsapp" | "both" | "whatsapp_fallback";

const CHANNEL_LABEL: Record<Channel, string> = {
  sms: "SMS",
  whatsapp: "WhatsApp",
  both: "SMS + WhatsApp",
  whatsapp_fallback: "WhatsApp with SMS Fallback",
};

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-surface-2 text-muted",
  queued: "bg-blue-100 text-blue-700",
  processing: "bg-amber-100 text-amber-700",
  sent: "bg-emerald-100 text-emerald-700",
  partially_sent: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-surface-2 text-muted",
};

// ─── Component ───────────────────────────────────────────────────────

export function CommsCenter({
  series,
  initialTemplates,
  initialCampaigns,
  isSuperAdmin,
}: {
  series: SeriesOption[];
  initialTemplates: Template[];
  initialCampaigns: Campaign[];
  isSuperAdmin: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"compose" | "history" | "templates">("compose");
  const [templates, setTemplates] = useState<Template[]>(initialTemplates);
  const campaigns = initialCampaigns;

  // ── Composer state ──
  const [name, setName] = useState("");
  const [group, setGroup] = useState<Group>("all_active");
  const [seriesId, setSeriesId] = useState("");
  const [channel, setChannel] = useState<Channel>("whatsapp_fallback");
  const [respectPrefs, setRespectPrefs] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [message, setMessage] = useState("");
  const [recips, setRecips] = useState<PreviewRecipient[]>([]);
  const [stats, setStats] = useState({ total_selected: 0, valid_phones: 0, invalid_phones: 0, duplicates_removed: 0 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loadingRecips, setLoadingRecips] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sendProgress, setSendProgress] = useState<{ done: number; total: number } | null>(null);

  // Load recipients whenever the group/series changes; for the
  // Individual group load the full list once for searching.
  const loadRecipients = useCallback(async () => {
    setLoadingRecips(true);
    try {
      const params = new URLSearchParams();
      if (group === "individual") {
        params.set("group", "all_active"); // full searchable pool
      } else {
        params.set("group", group);
        if (group === "series") {
          if (!seriesId) { setRecips([]); return; }
          params.set("series_id", seriesId);
        }
      }
      const res = await fetch(`/api/admin/comms/recipients?${params.toString()}`);
      const json = await res.json();
      if (res.ok) {
        setRecips(json.recipients);
        setStats(json.stats);
      } else {
        toast.error(json.error ?? "Failed to load recipients");
      }
    } finally {
      setLoadingRecips(false);
    }
  }, [group, seriesId]);

  useEffect(() => {
    loadRecipients();
    setSelected(new Set());
  }, [loadRecipients]);

  const filteredRecips = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recips;
    return recips.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        r.investor_code.toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q) ||
        (r.phone_raw ?? "").replace(/\D/g, "").includes(q.replace(/\D/g, "") || "∅")
    );
  }, [recips, search]);

  const effectiveRecipients = useMemo(
    () => (group === "individual" ? recips.filter((r) => selected.has(r.investor_id)) : recips),
    [group, recips, selected]
  );
  const sendableCount = effectiveRecipients.filter((r) => !r.skip_reason).length;
  const excludedCount = effectiveRecipients.length - sendableCount;

  // ── SMS estimation (uses the raw template; personalised lengths vary) ──
  const units = smsUnits(message);
  const smsInvolved = channel !== "whatsapp";
  const estUnits = smsInvolved ? units * sendableCount : 0;
  const estCost = estUnits * 4; // display estimate; server computes authoritative figure

  // Preview with the first sendable recipient's data
  const previewText = useMemo(() => {
    const sample = effectiveRecipients.find((r) => !r.skip_reason);
    let text = message;
    const vars = sample?.sample_vars ?? {
      first_name: "Aisha", full_name: "Aisha Bello", registered_email: "investor@email.com",
      investor_code: "MG-7K4P9X", series_name: "Series A", maturity_date: "30 Sept 2026",
      total_slots: "2", portal_url: "https://maalgrow.maalvest.com",
    };
    for (const [k, v] of Object.entries(vars)) {
      if (v) text = text.replaceAll(`{{${k}}}`, v);
    }
    return text;
  }, [message, effectiveRecipients]);

  const insertVariable = (v: string) => setMessage((m) => m + `{{${v}}}`);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) setMessage(t.body);
  };

  // ── Create + send ──
  const createCampaign = async (status: "draft" | "queued") => {
    const res = await fetch("/api/admin/comms/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        template_id: templateId || null,
        channel,
        message_body: message,
        recipient_group: group,
        series_id: group === "series" ? seriesId : null,
        investor_ids: group === "individual" ? [...selected] : null,
        respect_preferences: respectPrefs,
        status,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error ?? "Failed to create campaign");
      return null;
    }
    return json.campaign as { id: string; sendable: number };
  };

  const handleSaveDraft = async () => {
    setBusy("draft");
    try {
      const c = await createCampaign("draft");
      if (c) {
        toast.success("Draft saved — find it under History");
        router.refresh();
        setConfirmOpen(false);
      }
    } finally {
      setBusy(null);
    }
  };

  const handleSend = async () => {
    setBusy("send");
    try {
      const c = await createCampaign("queued");
      if (!c) return;
      setSendProgress({ done: 0, total: c.sendable });

      let done = false;
      let processed = 0;
      let guard = 0;
      while (!done && guard < 500) {
        guard++;
        const res = await fetch(`/api/admin/comms/campaigns/${c.id}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 15 }),
        });
        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error ?? "Sending failed — open the campaign to retry");
          break;
        }
        processed += json.processed;
        setSendProgress({ done: processed, total: c.sendable });
        done = json.done;
        if (done) {
          toast.success(
            json.campaignStatus === "sent"
              ? "Communication sent to all recipients ✓"
              : `Finished with status: ${json.campaignStatus.replaceAll("_", " ")} — open the campaign for details`
          );
        }
      }
      setConfirmOpen(false);
      setSendProgress(null);
      router.push(`/admin/comms/${c.id}`);
    } finally {
      setBusy(null);
      setSendProgress(null);
    }
  };

  const composerValid =
    name.trim().length >= 3 &&
    message.trim().length >= 10 &&
    sendableCount > 0 &&
    !/\{\{\s*(?!first_name|full_name|registered_email|investor_code|series_name|maturity_date|total_slots|portal_url)[a-z_]+\s*\}\}/i.test(message);

  // ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-2 border-b border-border">
        {(
          [
            { key: "compose", label: "New Communication", icon: <Send className="h-4 w-4" /> },
            { key: "history", label: "Communication History", icon: <MessageSquare className="h-4 w-4" /> },
            { key: "templates", label: "Templates", icon: <Copy className="h-4 w-4" /> },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === t.key
                ? "border-primary-600 text-primary-700"
                : "border-transparent text-muted hover:text-foreground"
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ══ COMPOSE ══ */}
      {tab === "compose" && (
        <div className="grid gap-6 xl:grid-cols-5">
          <div className="xl:col-span-3 space-y-6">
            {/* Campaign name */}
            <Card>
              <CardContent className="pt-6">
                <Input
                  label="Campaign Name"
                  placeholder="e.g. Portal Migration — Series A investors"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </CardContent>
            </Card>

            {/* Recipients */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recipients</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { key: "all_active", label: "All Active Investors", icon: <Users className="h-4 w-4" /> },
                      { key: "series", label: "Investors in a Series", icon: <Layers className="h-4 w-4" /> },
                      { key: "individual", label: "Individual Investors", icon: <UserSearch className="h-4 w-4" /> },
                    ] as { key: Group; label: string; icon: React.ReactNode }[]
                  ).map((g) => (
                    <button
                      key={g.key}
                      onClick={() => setGroup(g.key)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border-2 px-3.5 py-2 text-sm font-medium transition-all",
                        group === g.key
                          ? "border-primary-500 bg-primary-50 text-primary-700"
                          : "border-border text-muted hover:border-primary-200"
                      )}
                    >
                      {g.icon}
                      {g.label}
                    </button>
                  ))}
                </div>

                {group === "series" && (
                  <div className="space-y-2">
                    {series.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setSeriesId(s.id)}
                        className={cn(
                          "w-full rounded-lg border-2 p-3 text-left text-sm transition-all",
                          seriesId === s.id
                            ? "border-primary-500 bg-primary-50"
                            : "border-border hover:border-primary-200"
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold">Series {s.name}</span>
                          <span className="text-xs text-muted">
                            {s.cycle_label ?? "—"} ·{" "}
                            {s.start_date ? `${formatDate(s.start_date)} → ${formatDate(s.end_date!)}` : ""} ·{" "}
                            {s.status.replaceAll("_", " ")} · {s.investors} investor{s.investors !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {group === "individual" && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex-1 min-w-[200px]">
                        <Input
                          placeholder="Search by name, investor code, phone, or email…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setSelected(new Set(filteredRecips.map((r) => r.investor_id)))}>
                        Select All
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                        Clear Selection
                      </Button>
                    </div>
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                      {filteredRecips.slice(0, 200).map((r) => (
                        <label key={r.investor_id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-primary-50/30">
                          <input
                            type="checkbox"
                            checked={selected.has(r.investor_id)}
                            onChange={(e) => {
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(r.investor_id);
                                else next.delete(r.investor_id);
                                return next;
                              });
                            }}
                          />
                          <span className="flex-1">
                            <span className="font-medium">{r.full_name}</span>{" "}
                            <span className="text-xs text-muted">
                              {r.investor_code} · {r.phone_raw ?? "no phone"} · {r.email}
                            </span>
                          </span>
                          {r.skip_reason && (
                            <span className="text-[10px] text-red-600">{r.skip_reason}</span>
                          )}
                        </label>
                      ))}
                      {filteredRecips.length === 0 && (
                        <p className="p-4 text-sm text-muted text-center">No investors match your search</p>
                      )}
                    </div>
                    <p className="text-xs text-muted">{selected.size} selected</p>
                  </div>
                )}

                {/* Stats banner */}
                <div className="rounded-lg bg-primary-50 border border-primary-100 p-3 text-sm">
                  {loadingRecips ? (
                    <span className="text-muted">Loading recipients…</span>
                  ) : (
                    <>
                      <span className="font-semibold text-primary-800">
                        {sendableCount} investor{sendableCount !== 1 ? "s" : ""} will receive this communication.
                      </span>
                      <span className="block text-xs text-primary-700 mt-1">
                        Selected: {effectiveRecipients.length} · Valid phone numbers: {sendableCount} ·
                        Invalid: {group === "individual" ? effectiveRecipients.filter(r => r.skip_reason?.includes("phone")).length : stats.invalid_phones} ·
                        Duplicates removed: {stats.duplicates_removed}
                        {excludedCount > 0 ? ` · Excluded: ${excludedCount}` : ""}
                      </span>
                    </>
                  )}
                </div>

                {/* Exactly who is excluded, and why — with a link to fix it */}
                {!loadingRecips && excludedCount > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-semibold text-amber-800 mb-2">
                      {excludedCount} investor{excludedCount !== 1 ? "s" : ""} will NOT
                      receive this communication:
                    </p>
                    <div className="max-h-40 overflow-y-auto space-y-1.5">
                      {effectiveRecipients
                        .filter((r) => r.skip_reason)
                        .map((r) => (
                          <div
                            key={r.investor_id}
                            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs text-amber-900"
                          >
                            <span>
                              <span className="font-medium">{r.full_name}</span>{" "}
                              <span className="font-mono text-amber-700">
                                {r.investor_code}
                              </span>
                              {" — "}
                              {r.skip_reason}
                            </span>
                            <a
                              href={`/admin/investors/${r.investor_id}/edit`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary-700 underline hover:text-primary-800 shrink-0"
                            >
                              Fix phone →
                            </a>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Channel */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Delivery Method</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-2">
                  {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => (
                    <button
                      key={c}
                      onClick={() => setChannel(c)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border-2 px-3.5 py-2.5 text-sm font-medium transition-all",
                        channel === c
                          ? "border-primary-500 bg-primary-50 text-primary-700"
                          : "border-border text-muted hover:border-primary-200"
                      )}
                    >
                      <Smartphone className="h-4 w-4" />
                      {CHANNEL_LABEL[c]}
                    </button>
                  ))}
                </div>
                {channel === "whatsapp_fallback" && (
                  <p className="text-xs text-muted">
                    WhatsApp is attempted first; SMS is sent only if WhatsApp fails or the
                    number cannot receive WhatsApp. Duplicates are never sent.
                  </p>
                )}
                <label className="flex items-center gap-2 text-sm cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={respectPrefs}
                    onChange={(e) => setRespectPrefs(e.target.checked)}
                  />
                  Respect each investor's preferred channel (untick to override for critical
                  operational notices)
                </label>
              </CardContent>
            </Card>

            {/* Message */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Message</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-foreground">Template</label>
                  <select
                    value={templateId}
                    onChange={(e) => applyTemplate(e.target.value)}
                    className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                  >
                    <option value="">Write from scratch…</option>
                    {templates
                      .filter((t) => t.status === "active")
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.is_builtin ? " (built-in)" : ""}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATE_VARIABLES.map((v) => (
                    <button
                      key={v}
                      onClick={() => insertVariable(v)}
                      className="rounded-full bg-surface-2 hover:bg-primary-100 hover:text-primary-700 px-2.5 py-1 text-[11px] font-mono transition-colors"
                    >
                      {"{{"}{v}{"}}"}
                    </button>
                  ))}
                </div>

                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={9}
                  placeholder="Dear {{first_name}}, …"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                />

                {smsInvolved && (
                  <div className="flex flex-wrap gap-4 text-xs text-muted">
                    <span>Characters: <span className="font-semibold text-foreground">{message.length}</span></span>
                    <span>SMS units per message: <span className="font-semibold text-foreground">{units}</span></span>
                    <span>Total units: <span className="font-semibold text-foreground">{estUnits}</span></span>
                    <span>Estimated cost: <span className="font-semibold text-foreground">{formatCurrency(estCost)}</span></span>
                    <span>Recipients: <span className="font-semibold text-foreground">{sendableCount}</span></span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Preview + actions */}
          <div className="xl:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-2xl bg-[#e5ded5] p-4">
                  <div className="max-w-[95%] rounded-xl rounded-tl-sm bg-white p-3 text-sm whitespace-pre-wrap shadow-sm">
                    {previewText || <span className="text-muted">Your message preview appears here…</span>}
                  </div>
                </div>
                <p className="text-[11px] text-muted mt-2">
                  Preview uses the first recipient's real details. Variables are personalised
                  per investor; messages with unresolved variables are never sent.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6 space-y-2">
                <Button
                  className="w-full"
                  disabled={!composerValid}
                  onClick={() => setConfirmOpen(true)}
                >
                  <Send className="h-4 w-4" />
                  Review &amp; Send
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!composerValid}
                  loading={busy === "draft"}
                  onClick={handleSaveDraft}
                >
                  <Save className="h-4 w-4" />
                  Save Draft
                </Button>
                {!composerValid && (
                  <p className="text-[11px] text-muted">
                    Requires: a campaign name, a message (only supported variables), and at
                    least one valid recipient.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ══ HISTORY ══ */}
      {tab === "history" && (
        <Card>
          <CardContent className="p-0">
            {campaigns.length === 0 ? (
              <p className="text-sm text-muted text-center py-12">
                No communications yet. Every campaign is stored here permanently.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-surface-2">
                    <tr>
                      {["Campaign", "Created By", "Date", "Group", "Channel", "Recipients", "Sent", "Failed", "Est. Cost", "Status", ""].map((h) => (
                        <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-muted uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {campaigns.map((c) => (
                      <tr key={c.id} className="hover:bg-primary-50/30 transition-colors">
                        <td className="py-3 px-3 font-semibold">{c.name}</td>
                        <td className="py-3 px-3 text-xs">{c.creator?.full_name ?? c.creator?.email ?? "—"}</td>
                        <td className="py-3 px-3 text-xs">{formatDate(c.created_at)}</td>
                        <td className="py-3 px-3 text-xs">
                          {c.recipient_group === "series"
                            ? `Series ${c.series?.name ?? "?"}`
                            : c.recipient_group === "all_active"
                            ? "All active"
                            : "Individual"}
                        </td>
                        <td className="py-3 px-3 text-xs">{CHANNEL_LABEL[c.channel as Channel] ?? c.channel}</td>
                        <td className="py-3 px-3">{c.total_recipients}</td>
                        <td className="py-3 px-3 text-emerald-600 font-semibold">{c.sent_count}</td>
                        <td className={cn("py-3 px-3 font-semibold", c.failed_count > 0 ? "text-red-600" : "text-muted")}>{c.failed_count}</td>
                        <td className="py-3 px-3 text-xs">{formatCurrency(c.estimated_cost)}</td>
                        <td className="py-3 px-3">
                          <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", STATUS_STYLE[c.status] ?? "bg-surface-2")}>
                            {c.status.replaceAll("_", " ")}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <Link href={`/admin/comms/${c.id}`} className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline font-medium">
                            Open <ChevronRight className="h-3.5 w-3.5" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ══ TEMPLATES ══ */}
      {tab === "templates" && (
        <TemplateManager templates={templates} setTemplates={setTemplates} isSuperAdmin={isSuperAdmin} />
      )}

      {/* ══ Confirmation dialog ══ */}
      <Dialog open={confirmOpen} onOpenChange={(o) => !o && !sendProgress && setConfirmOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm Communication</DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-4">
            <div className="space-y-1.5 text-sm">
              {[
                ["Campaign Name", name],
                ["Recipient Group", group === "series" ? `Series ${series.find((s) => s.id === seriesId)?.name ?? ""}` : group === "all_active" ? "All Active Investors" : `${selected.size} selected investors`],
                ["Delivery Method", CHANNEL_LABEL[channel]],
                ["Recipients", String(sendableCount)],
                ["Excluded Investors", String(excludedCount + stats.invalid_phones + stats.duplicates_removed)],
                ["Estimated SMS Units", smsInvolved ? String(estUnits) : "— (WhatsApp only)"],
                ["Estimated Cost", smsInvolved ? formatCurrency(estCost) : "—"],
                ["Preferences", respectPrefs ? "Respect investor preferences" : "Override (operational notice)"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <span className="text-muted">{k}</span>
                  <span className="font-semibold text-right">{v}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-surface-2 p-3 text-xs whitespace-pre-wrap max-h-40 overflow-y-auto">
              {previewText}
            </div>

            {sendProgress && (
              <div>
                <div className="flex justify-between text-xs text-muted mb-1.5">
                  <span>Sending… safe to leave this page; duplicates are impossible</span>
                  <span>{sendProgress.done}/{sendProgress.total}</span>
                </div>
                <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className="h-full bg-primary-600 transition-all"
                    style={{ width: `${sendProgress.total ? Math.round((sendProgress.done / sendProgress.total) * 100) : 0}%` }}
                  />
                </div>
              </div>
            )}

            <DialogFooter className="!p-0 !border-0">
              <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={!!sendProgress}>
                Cancel
              </Button>
              <Button variant="outline" onClick={handleSaveDraft} loading={busy === "draft"} disabled={!!sendProgress}>
                Save Draft
              </Button>
              <Button onClick={handleSend} loading={busy === "send"}>
                <Send className="h-4 w-4" />
                Send Communication
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Template Manager ────────────────────────────────────────────────

function TemplateManager({
  templates,
  setTemplates,
  isSuperAdmin,
}: {
  templates: Template[];
  setTemplates: (t: Template[]) => void;
  isSuperAdmin: boolean;
}) {
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    const res = await fetch("/api/admin/comms/templates");
    const json = await res.json();
    if (res.ok) setTemplates(json.templates);
  };

  const act = async (t: Template, action: "archive" | "restore" | "duplicate") => {
    setBusy(t.id + action);
    try {
      const res = await fetch(`/api/admin/comms/templates/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) toast.error((await res.json()).error ?? "Action failed");
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" />
          New Template
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {templates.map((t) => (
          <Card key={t.id} className={t.status === "archived" ? "opacity-60" : ""}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm">
                  {t.name}
                  {t.is_builtin && (
                    <span className="ml-2 rounded-full bg-primary-100 text-primary-700 text-[10px] font-bold px-1.5 py-0.5 uppercase">built-in</span>
                  )}
                  {t.status === "archived" && (
                    <span className="ml-2 rounded-full bg-surface-2 text-muted text-[10px] font-bold px-1.5 py-0.5 uppercase">archived</span>
                  )}
                </CardTitle>
                <div className="flex gap-1 shrink-0">
                  <button title="Edit" onClick={() => setEditing(t)} className="p-1.5 rounded hover:bg-surface-2 text-muted hover:text-foreground">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button title="Duplicate" onClick={() => act(t, "duplicate")} className="p-1.5 rounded hover:bg-surface-2 text-muted" disabled={busy === t.id + "duplicate"}>
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  {(!t.is_builtin || isSuperAdmin) && (
                    <button
                      title={t.status === "archived" ? "Restore" : "Archive"}
                      onClick={() => act(t, t.status === "archived" ? "restore" : "archive")}
                      className="p-1.5 rounded hover:bg-surface-2 text-muted"
                    >
                      {t.status === "archived" ? <RotateCcw className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-muted">Channel: {t.channel}</p>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted whitespace-pre-wrap line-clamp-5">{t.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {editing && (
        <TemplateDialog
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function TemplateDialog({
  template,
  onClose,
  onSaved,
}: {
  template: Template | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [f, setF] = useState({
    name: template?.name ?? "",
    channel: (template?.channel ?? "both") as "sms" | "whatsapp" | "both",
    body: template?.body ?? "",
    whatsapp_template_code: template?.whatsapp_template_code ?? "",
    header_media_url: template?.header_media_url ?? "",
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        name: f.name,
        channel: f.channel,
        body: f.body,
        whatsapp_template_code: f.whatsapp_template_code || null,
        header_media_url: f.header_media_url || null,
      };
      const res = template
        ? await fetch(`/api/admin/comms/templates/${template.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/admin/comms/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        toast.error((await res.json()).error ?? "Failed to save template");
        return;
      }
      toast.success("Template saved");
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{template ? `Edit: ${template.name}` : "New Template"}</DialogTitle>
        </DialogHeader>
        <div className="p-6 space-y-3">
          <Input label="Template Name" value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} required />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium">Channel</label>
            <select
              value={f.channel}
              onChange={(e) => setF((p) => ({ ...p, channel: e.target.value as typeof f.channel }))}
              className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm"
            >
              <option value="both">SMS + WhatsApp</option>
              <option value="sms">SMS only</option>
              <option value="whatsapp">WhatsApp only</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium">Message</label>
            <textarea
              value={f.body}
              onChange={(e) => setF((p) => ({ ...p, body: e.target.value }))}
              rows={8}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
            />
            <p className="text-[11px] text-muted">
              Variables: {TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(" ")}
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Input
              label="WhatsApp Template Code (optional)"
              placeholder="Sendchamp-approved code"
              value={f.whatsapp_template_code}
              onChange={(e) => setF((p) => ({ ...p, whatsapp_template_code: e.target.value }))}
            />
            <Input
              label="Header Image/PDF URL (optional)"
              placeholder="https://…"
              value={f.header_media_url}
              onChange={(e) => setF((p) => ({ ...p, header_media_url: e.target.value }))}
            />
          </div>
          <DialogFooter className="!p-0 !border-0 !mt-4">
            <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={save} loading={saving} disabled={!f.name.trim() || !f.body.trim()}>Save Template</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
