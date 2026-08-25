"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Copy,
  Edit,
  Ban,
  UserCheck,
  KeyRound,
  MailPlus,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type Action = "deactivate" | "reactivate" | "reset_password" | "resend_invite";

interface InvestorActionsProps {
  investorId: string;
  investorName: string;
  investorEmail: string;
  isActive: boolean;
}

const ACTION_CONFIG: Record<
  Action,
  {
    label: string;
    description: string;
    confirmLabel: string;
    successMessage: string;
    variant: "destructive" | "default" | "outline";
  }
> = {
  deactivate: {
    label: "Deactivate Account",
    description:
      "This will suspend the investor's access to the portal. They will not be able to log in until reactivated.",
    confirmLabel: "Yes, deactivate",
    successMessage: "Account deactivated",
    variant: "destructive",
  },
  reactivate: {
    label: "Reactivate Account",
    description:
      "This will restore the investor's access to the portal so they can log in again.",
    confirmLabel: "Yes, reactivate",
    successMessage: "Account reactivated",
    variant: "default",
  },
  reset_password: {
    label: "Send Password Reset",
    description: `A password reset email will be sent to the investor's email address. They will be able to set a new password using that link.`,
    confirmLabel: "Send email",
    successMessage: "Password reset email sent",
    variant: "outline",
  },
  resend_invite: {
    label: "Resend Invitation",
    description:
      "A new invitation email will be sent to the investor. The previous invite link will be invalidated.",
    confirmLabel: "Resend",
    successMessage: "Invitation resent",
    variant: "outline",
  },
};

export function InvestorActions({
  investorId,
  investorName,
  isActive,
}: InvestorActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<Action | null>(null);
  const [confirmAction, setConfirmAction] = useState<Action | null>(null);
  const [settingPassword, setSettingPassword] = useState(false);
  const [reason, setReason] = useState("");
  // Held in state and shown ONCE. Never sent anywhere, never stored.
  const [issued, setIssued] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);

  const setTemporaryPassword = async () => {
    setIssuing(true);
    try {
      const res = await fetch(`/api/admin/investors/${investorId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_password", reason }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Could not set the password");
        return;
      }
      setIssued(json.password as string);
      setSettingPassword(false);
      setReason("");
      router.refresh();
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setIssuing(false);
    }
  };

  const run = async (action: Action) => {
    setConfirmAction(null);
    setPending(action);

    try {
      // Resend invitation uses the dedicated endpoint
      const url =
        action === "resend_invite"
          ? `/api/admin/investors/${investorId}/resend-invitation`
          : `/api/admin/investors/${investorId}`;
      const method = action === "resend_invite" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(action !== "resend_invite"
          ? { body: JSON.stringify({ action }) }
          : {}),
      });

      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error ?? "Action failed. Please try again.");
      } else {
        toast.success(ACTION_CONFIG[action].successMessage);
        router.refresh();
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setPending(null);
    }
  };

  const openConfirm = (action: Action) => setConfirmAction(action);

  const isLoading = (action: Action) => pending === action;
  const anyPending = pending !== null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Link href={`/admin/investors/${investorId}/edit`}>
          <Button variant="outline" size="sm" disabled={anyPending}>
            <Edit className="h-4 w-4" />
            Edit
          </Button>
        </Link>

        <Button
          variant="outline"
          size="sm"
          disabled={anyPending}
          onClick={() => openConfirm("reset_password")}
          loading={isLoading("reset_password")}
        >
          <KeyRound className="h-4 w-4" />
          Reset Password
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={anyPending}
          onClick={() => openConfirm("resend_invite")}
          loading={isLoading("resend_invite")}
        >
          <MailPlus className="h-4 w-4" />
          Resend Invite
        </Button>

        {/* The last resort, for an investor email cannot reach. Kept
            visually quieter than Reset Password, because Reset
            Password is the one that should almost always be used. */}
        <Button
          variant="ghost"
          size="sm"
          disabled={anyPending}
          onClick={() => setSettingPassword(true)}
        >
          <KeyRound className="h-4 w-4" />
          Set Temporary Password
        </Button>

        {isActive ? (
          <Button
            variant="destructive"
            size="sm"
            disabled={anyPending}
            onClick={() => openConfirm("deactivate")}
            loading={isLoading("deactivate")}
          >
            <Ban className="h-4 w-4" />
            Deactivate
          </Button>
        ) : (
          <Button
            variant="default"
            size="sm"
            disabled={anyPending}
            onClick={() => openConfirm("reactivate")}
            loading={isLoading("reactivate")}
          >
            <UserCheck className="h-4 w-4" />
            Reactivate
          </Button>
        )}
      </div>

      {/* Confirmation dialog */}
      {confirmAction && (
        <Dialog open onOpenChange={() => setConfirmAction(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{ACTION_CONFIG[confirmAction].label}</DialogTitle>
              <DialogDescription>
                <strong>{investorName}</strong> —{" "}
                {ACTION_CONFIG[confirmAction].description}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmAction(null)}
                disabled={anyPending}
              >
                Cancel
              </Button>
              <Button
                variant={ACTION_CONFIG[confirmAction].variant}
                size="sm"
                onClick={() => run(confirmAction)}
                disabled={anyPending}
              >
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {ACTION_CONFIG[confirmAction].confirmLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Ask why, before doing it */}
      <Dialog open={settingPassword} onOpenChange={(o) => !o && setSettingPassword(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set a temporary password for {investorName}?</DialogTitle>
            <DialogDescription>
              Use this only when a reset email cannot reach them. It is shown to
              you once, on the next screen — it is never emailed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-6 pb-2">
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-medium">You will know their password.</p>
              <p className="mt-1 text-amber-800/90">
                Until they sign in and change it, anything done from their
                account is indistinguishable from them doing it. The portal will
                let them do nothing else until they have chosen their own — but
                give it to them directly and delete the message afterwards.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Why are you doing this?<span className="ml-0.5 text-danger">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="e.g. Reset emails are not reaching her — read out over the phone"
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
              <p className="text-xs text-muted">
                Recorded against your name in the audit log.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSettingPassword(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={reason.trim().length < 5 || issuing}
              onClick={setTemporaryPassword}
            >
              {issuing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Set temporary password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Shown ONCE. Closing this is the last time anybody sees it. */}
      <Dialog open={!!issued} onOpenChange={(o) => !o && setIssued(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Temporary password for {investorName}</DialogTitle>
            <DialogDescription>
              Give this to them directly — by phone, or in person. It is not
              stored anywhere and cannot be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-6 pb-2">
            <div className="rounded-lg border border-border bg-surface-2 p-4 text-center">
              <p className="select-all font-mono text-2xl font-bold tracking-wider text-foreground">
                {issued}
              </p>
              <p className="mt-2 text-xs text-muted">
                No zero or letter O, no one or letter l — it reads cleanly aloud.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                if (issued) navigator.clipboard?.writeText(issued);
                toast.success("Copied");
              }}
            >
              <Copy className="h-4 w-4" />
              Copy
            </Button>
            <p className="text-xs text-muted">
              When they sign in, the portal will take them straight to the
              change-password screen and allow nothing else until they have set
              their own.
            </p>
          </div>
          <DialogFooter>
            <Button size="sm" onClick={() => setIssued(null)}>
              I have given it to them
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
