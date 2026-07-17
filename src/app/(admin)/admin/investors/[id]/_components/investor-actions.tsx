"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
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

  const run = async (action: Action) => {
    setConfirmAction(null);
    setPending(action);

    try {
      const res = await fetch(`/api/admin/investors/${investorId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
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
    </>
  );
}
