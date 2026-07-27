"use client";

/**
 * Creating and managing staff accounts, from inside the portal.
 *
 * WHY THE PORTAL AND NOT SUPABASE. Adding staff meant opening the
 * Supabase dashboard, creating an auth user, then remembering to set
 * the role on their profile row — three steps where forgetting the
 * third leaves someone with an investor account they cannot use, and
 * no email ever reaches them.
 *
 * NO PASSWORD IS EVER TYPED, SHOWN OR SENT. The account is created
 * with an invitation token and the new staff member sets their own
 * password from the emailed link. The same rule as investors, for the
 * same reason.
 *
 * DEACTIVATE, NEVER DELETE. Someone who leaves has approved payments
 * and settled cycles carrying their name. Deleting the profile would
 * orphan those records; banning the login stops them getting in while
 * the history stays readable.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  UserPlus,
  Mail,
  Loader2,
  ShieldOff,
  ShieldCheck,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { STAFF_ROLES, type StaffRole } from "@/lib/staff-roles";

export type StaffRow = {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
};

export function AddStaffButton({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("payment_officer");

  if (!canManage) return null;

  const chosen = STAFF_ROLES.find((r) => r.value === role);

  const submit = async () => {
    setSaving(true);
    const res = await fetch("/api/admin/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: fullName, email, role }),
    });
    const json = await res.json();
    setSaving(false);

    if (!res.ok) {
      toast.error(json.error ?? "Could not create the account");
      return;
    }

    // The account exists either way. Saying "created" when the email
    // silently failed would leave somebody waiting for a link that is
    // never coming.
    if (json.invited) {
      toast.success(`${fullName} has been invited by email`);
    } else {
      toast.warning(
        `Account created, but the invitation email did not send${
          json.inviteError ? ` (${json.inviteError})` : ""
        }. Use "Resend invitation" to try again.`
      );
    }

    setOpen(false);
    setFullName("");
    setEmail("");
    setRole("payment_officer");
    router.refresh();
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" />
        Add staff member
      </Button>

      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a staff member</DialogTitle>
            <DialogDescription>
              They receive an email and choose their own password. You never
              see or send it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 p-6">
            <Input
              label="Full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Aminat Lawal"
              autoFocus
            />
            <Input
              label="Email address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@maalvest.com"
            />

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">
                Role
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as StaffRole)}
                className="flex w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              >
                {STAFF_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              {/* The summary is the same text the invitation email
                  carries, so what you pick is what they are told. */}
              {chosen && (
                <p className="text-xs text-muted leading-relaxed pt-1">
                  {chosen.summary}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              loading={saving}
              disabled={!fullName.trim() || !email.trim() || saving}
            >
              Create and send invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function StaffActions({
  staff,
  canManage,
  isSelf,
}: {
  staff: StaffRow;
  canManage: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  if (!canManage) return null;

  const patch = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    const res = await fetch(`/api/admin/staff/${staff.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    setMenuOpen(false);
    setConfirmDeactivate(false);

    if (!res.ok) {
      toast.error(json.error ?? "That did not work");
      return;
    }
    toast.success(label);
    router.refresh();
  };

  return (
    <div className="relative flex items-center justify-end gap-1">
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted" />
      ) : (
        <>
          <button
            onClick={() => patch({ resend_invite: true }, "Invitation resent")}
            title="Resend invitation"
            className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <Mail className="h-4 w-4" />
          </button>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </>
      )}

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-9 z-20 w-56 rounded-lg border border-border bg-surface p-1 shadow-lg">
            <p className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted">
              Change role
            </p>
            {STAFF_ROLES.map((r) => (
              <button
                key={r.value}
                disabled={r.value === staff.role || (isSelf && r.value !== "super_admin")}
                onClick={() => patch({ role: r.value }, `Role changed to ${r.label}`)}
                className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                {r.label}
                {r.value === staff.role && (
                  <span className="ml-1 text-xs text-muted">· current</span>
                )}
              </button>
            ))}

            <div className="my-1 h-px bg-border" />

            {staff.is_active ? (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmDeactivate(true);
                }}
                disabled={isSelf}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-danger hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <ShieldOff className="h-3.5 w-3.5" />
                Deactivate account
              </button>
            ) : (
              <button
                onClick={() => patch({ is_active: true }, "Account reactivated")}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-success hover:bg-emerald-50"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Reactivate account
              </button>
            )}
          </div>
        </>
      )}

      <Dialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate {staff.full_name ?? staff.email}?</DialogTitle>
            <DialogDescription>
              They will not be able to sign in. Nothing they have already done is
              removed — approvals and payments keep their name on them, and you
              can reactivate the account at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDeactivate(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => patch({ is_active: false }, "Account deactivated")}
            >
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
