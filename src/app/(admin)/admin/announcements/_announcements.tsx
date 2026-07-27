"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Megaphone, Plus, Globe, Lock, Trash2, Send, Loader2, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Announcement = {
  id: string;
  title: string;
  body: string;
  audience: "all" | "investors" | "admins";
  published: boolean;
  created_at: string;
  /** How many people it actually reached, counted when it was sent */
  recipients: number;
};

export type ApiRow = {
  id: string;
  title: string;
  content: string;
  target_audience: "all" | "investors" | "admins";
  recipient_count: number;
  is_published: boolean;
  created_at: string;
};

function formatRelative(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export function AnnouncementsScreen({ rows }: { rows: ApiRow[] }) {
  const router = useRouter();
  const announcements: Announcement[] = rows.map((a) => ({
    id: a.id,
    title: a.title,
    body: a.content,
    audience: a.target_audience,
    published: a.is_published,
    created_at: a.created_at,
    recipients: a.recipient_count ?? 0,
  }));
  const [sending, setSending] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"all" | "investors" | "admins">("investors");
  /** Set while correcting one that has already gone out. */
  const [editingId, setEditingId] = useState<string | null>(null);

  const startEdit = (a: Announcement) => {
    setEditingId(a.id);
    setTitle(a.title);
    setBody(a.body);
    setAudience(a.audience);
    setShowForm(true);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setTitle("");
    setBody("");
    setAudience("investors");
  };

  const handleCreate = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error("An announcement needs a title and a message.");
      return;
    }
    setSending(true);
    try {
      // Editing corrects the record AND every copy already delivered.
      // The audience cannot change: those notifications are already in
      // specific people's hands, and re-aiming them would mean sending
      // to some and silently retracting from others.
      const res = await fetch("/api/admin/announcements", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editingId
            ? { id: editingId, title, message: body }
            : { title, message: body, audience }
        ),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save the announcement");

      if (editingId) {
        const n = Number(json.notificationsUpdated ?? 0);
        toast.success(
          `Updated — corrected in ${n} ${n === 1 ? "person's" : "people's"} notifications`
        );
      } else {
        // The count is what makes this real rather than reassuring —
        // it is the number of notifications actually written.
        const n = Number(json.recipients ?? 0);
        toast.success(
          n === 0
            ? "Announcement saved, but it reached nobody — check the audience."
            : `Sent to ${n} ${n === 1 ? "person" : "people"}`
        );
      }
      cancelForm();
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save the announcement"
      );
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/announcements?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not withdraw it");
      const n = Number(json.notificationsRemoved ?? 0);
      toast.success(
        `Withdrawn — removed from ${n} ${n === 1 ? "person's" : "people's"} notifications`
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not withdraw it");
    }
  };

  const audienceConfig: Record<string, { label: string; icon: React.ReactNode; variant: "active" | "pending" | "approved" }> = {
    all: { label: "All Users", icon: <Globe className="h-3 w-3" />, variant: "active" },
    investors: { label: "Investors", icon: <Globe className="h-3 w-3" />, variant: "approved" },
    admins: { label: "Admins Only", icon: <Lock className="h-3 w-3" />, variant: "pending" },
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Announcements</h1>
          <p className="text-sm text-muted mt-1">Publish notices to investors and staff</p>
        </div>
        <Button
          onClick={() => (showForm ? cancelForm() : setShowForm(true))}
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          New Announcement
        </Button>
      </div>

      {showForm && (
        <Card className="border-primary-200">
          <CardHeader>
            <CardTitle className="text-base">
              {editingId ? "Edit Announcement" : "Create Announcement"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Announcement title…"
            />
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Message</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={"Write your announcement here…\n\nLeave a blank line between paragraphs — investors see them exactly as you lay them out."}
                rows={10}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm leading-7 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary-400 resize-y"
              />
              <p className="text-xs text-muted">
                A blank line starts a new paragraph. Long announcements are
                much easier to read broken into a few short ones.
              </p>
            </div>
            <div className="space-y-1.5" hidden={Boolean(editingId)}>
              <label className="text-sm font-medium text-foreground">Audience</label>
              <div className="flex gap-3">
                {(["investors", "all", "admins"] as const).map((a) => (
                  <button
                    key={a}
                    onClick={() => setAudience(a)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium border transition-colors ${
                      audience === a
                        ? "border-primary-500 bg-primary-50 text-primary-700"
                        : "border-border bg-surface text-muted hover:bg-surface-2"
                    }`}
                  >
                    {audienceConfig[a].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button
                onClick={handleCreate}
                disabled={sending}
                className="flex items-center gap-2"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {sending
                  ? editingId
                    ? "Saving…"
                    : "Sending…"
                  : editingId
                  ? "Save changes"
                  : "Publish"}
              </Button>
              <Button variant="outline" onClick={cancelForm}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {announcements.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Megaphone className="h-12 w-12 text-border mb-4" />
            <p className="font-medium text-foreground">No announcements yet</p>
            <p className="text-sm text-muted mt-1">Create your first announcement above.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {announcements.map((announcement) => {
            const config = audienceConfig[announcement.audience];
            return (
              <Card key={announcement.id}>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <h3 className="font-semibold text-foreground">{announcement.title}</h3>
                        <Badge variant={config.variant}>
                          {config.icon}
                          {config.label}
                        </Badge>
                        {announcement.published && (
                          <Badge variant="active" dot>Published</Badge>
                        )}
                      </div>
                      <p className="text-sm text-foreground/80 leading-7 whitespace-pre-line">
                        {announcement.body}
                      </p>
                      <p className="text-xs text-muted mt-2">
                        {formatRelative(announcement.created_at)} · sent to{" "}
                        {announcement.recipients}{" "}
                        {announcement.recipients === 1 ? "person" : "people"}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <button
                        onClick={() => startEdit(announcement)}
                        title="Edit — corrects it in everyone's notifications too"
                        className="rounded-lg p-1.5 text-muted hover:bg-primary-50 hover:text-primary-700 transition-colors"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(announcement.id)}
                        title="Withdraw — removes it from everyone's notifications"
                        className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
