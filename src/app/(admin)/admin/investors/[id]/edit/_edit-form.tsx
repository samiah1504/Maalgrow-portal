"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const schema = z.object({
  full_name: z.string().min(2, "Full name must be at least 2 characters"),
  phone: z.string().optional(),
  address: z.string().optional(),
  bank_name: z.string().optional(),
  account_name: z.string().optional(),
  account_number: z.string().optional(),
  bvn: z
    .string()
    .optional()
    .refine((v) => !v || v.length === 11, "BVN must be 11 digits"),
  nin: z
    .string()
    .optional()
    .refine((v) => !v || v.length === 11, "NIN must be 11 digits"),
  // Optional. Its only use is the withholding tax credit note.
  tin: z.string().optional(),
  kyc_status: z.enum(["pending", "approved", "rejected"]),
  kyc_notes: z.string().optional(),
  preferred_channel: z.enum(["sms", "whatsapp", "both"]),
});

type FormData = z.infer<typeof schema>;

interface Investor {
  id: string;
  full_name: string;
  phone: string | null;
  address: string | null;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  bvn: string | null;
  nin: string | null;
  tin: string | null;
  kyc_status: string;
  kyc_notes: string | null;
  preferred_channel: string | null;
}

export function EditInvestorForm({ investor }: { investor: Investor }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: investor.full_name,
      phone: investor.phone ?? "",
      address: investor.address ?? "",
      bank_name: investor.bank_name ?? "",
      account_name: investor.account_name ?? "",
      account_number: investor.account_number ?? "",
      bvn: investor.bvn ?? "",
      nin: investor.nin ?? "",
      tin: investor.tin ?? "",
      kyc_status: investor.kyc_status as "pending" | "approved" | "rejected",
      kyc_notes: investor.kyc_notes ?? "",
      preferred_channel: (investor.preferred_channel ?? "sms") as "sms" | "whatsapp" | "both",
    },
  });

  const onSubmit = async (data: FormData) => {
    setServerError(null);

    const res = await fetch(`/api/admin/investors/${investor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", ...data }),
    });

    const json = await res.json();

    if (!res.ok) {
      setServerError(json.error ?? "Something went wrong. Please try again.");
      return;
    }

    toast.success("Investor updated successfully");
    router.push(`/admin/investors/${investor.id}`);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Personal info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Personal Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            {...register("full_name")}
            label="Full Name"
            error={errors.full_name?.message}
            required
          />
          <Input
            {...register("phone")}
            type="tel"
            label="Phone Number"
            placeholder="+2348012345678"
            error={errors.phone?.message}
          />
          <Input
            {...register("address")}
            label="Address"
            placeholder="123 Main Street, Lagos"
            error={errors.address?.message}
          />
        </CardContent>
      </Card>

      {/* Bank details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Bank Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            {...register("bank_name")}
            label="Bank Name"
            error={errors.bank_name?.message}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              {...register("account_name")}
              label="Account Name"
              error={errors.account_name?.message}
            />
            <Input
              {...register("account_number")}
              label="Account Number"
              error={errors.account_number?.message}
            />
          </div>
        </CardContent>
      </Card>

      {/* Identity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Identity Documents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              {...register("bvn")}
              label="BVN"
              maxLength={11}
              error={errors.bvn?.message}
            />
            <Input
              {...register("nin")}
              label="NIN"
              maxLength={11}
              error={errors.nin?.message}
            />
          </div>
          <Input
            {...register("tin")}
            label="Tax Identification Number (TIN)"
            placeholder="Optional"
            error={errors.tin?.message}
            hint="Needed only to issue a withholding tax credit note. A blank TIN blocks nothing else."
          />
        </CardContent>
      </Card>

      {/* KYC */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">KYC Verification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              KYC Status <span className="ml-0.5 text-danger">*</span>
            </label>
            <select
              {...register("kyc_status")}
              className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            >
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            {errors.kyc_status && (
              <p className="text-xs text-danger">{errors.kyc_status.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Preferred Communication Channel
            </label>
            <select
              {...register("preferred_channel")}
              className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            >
              <option value="sms">SMS</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="both">SMS + WhatsApp</option>
            </select>
            <p className="text-xs text-muted">
              Used by the Communication Centre when “respect preferences” is selected.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              KYC Notes
            </label>
            <textarea
              {...register("kyc_notes")}
              rows={3}
              placeholder="Add notes about the KYC verification…"
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
            />
          </div>
        </CardContent>
      </Card>

      {serverError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{serverError}</p>
        </div>
      )}

      <div className="flex gap-3">
        <Button
          type="submit"
          loading={isSubmitting}
          disabled={!isDirty}
          className="flex-1 sm:flex-none sm:min-w-32"
        >
          {isSubmitting ? "Saving…" : "Save Changes"}
        </Button>
        <Link href={`/admin/investors/${investor.id}`}>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}
