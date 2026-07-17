"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, UserPlus, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const schema = z.object({
  full_name: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
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
});

type FormData = z.infer<typeof schema>;

export default function NewInvestorPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setServerError(null);

    const res = await fetch("/api/admin/investors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    const json = await res.json();

    if (!res.ok) {
      setServerError(json.error ?? "Something went wrong. Please try again.");
      return;
    }

    setSuccess(true);
    toast.success("Investor created and invitation email sent!");

    setTimeout(() => {
      router.push(`/admin/investors/${json.investor.id}`);
    }, 1500);
  };

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-xl font-bold text-foreground">Investor Created</h2>
        <p className="text-sm text-muted">
          An invitation email has been sent. Redirecting…
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/investors"
          className="flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Investors
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
          <UserPlus className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Add Investor</h1>
          <p className="text-sm text-muted">
            An invitation email will be sent automatically.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Required info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Account Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              {...register("full_name")}
              label="Full Name"
              placeholder="Aminu Ibrahim"
              error={errors.full_name?.message}
              required
            />
            <Input
              {...register("email")}
              type="email"
              label="Email Address"
              placeholder="investor@example.com"
              hint="An invitation email will be sent to this address."
              error={errors.email?.message}
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
            <CardTitle className="text-sm">Bank Details (optional)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              {...register("bank_name")}
              label="Bank Name"
              placeholder="First Bank of Nigeria"
              error={errors.bank_name?.message}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                {...register("account_name")}
                label="Account Name"
                placeholder="Aminu Ibrahim"
                error={errors.account_name?.message}
              />
              <Input
                {...register("account_number")}
                label="Account Number"
                placeholder="0123456789"
                error={errors.account_number?.message}
              />
            </div>
          </CardContent>
        </Card>

        {/* Identity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Identity Documents (optional)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                {...register("bvn")}
                label="BVN"
                placeholder="12345678901"
                maxLength={11}
                error={errors.bvn?.message}
              />
              <Input
                {...register("nin")}
                label="NIN"
                placeholder="12345678901"
                maxLength={11}
                error={errors.nin?.message}
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
          <Button type="submit" loading={isSubmitting} className="flex-1 sm:flex-none sm:min-w-40">
            {isSubmitting ? "Creating…" : "Create Investor & Send Invite"}
          </Button>
          <Link href="/admin/investors">
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
