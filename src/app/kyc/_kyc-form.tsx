"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const schema = z.object({
  phone: z
    .string()
    .min(10, "Enter a valid phone number")
    .regex(/^[+\d][\d\s-]{8,}$/, "Enter a valid phone number"),
  address: z.string().min(10, "Enter your full residential address"),
  bvn: z
    .string()
    .regex(/^\d{11}$/, "BVN must be exactly 11 digits"),
  nin: z
    .string()
    .regex(/^\d{11}$/, "NIN must be exactly 11 digits")
    .or(z.literal(""))
    .optional(),
  bank_name: z.string().min(2, "Enter your bank name"),
  account_name: z.string().min(3, "Enter the account name"),
  account_number: z.string().regex(/^\d{10}$/, "Account number must be 10 digits"),
});

type FormData = z.infer<typeof schema>;

type Investor = {
  phone: string | null;
  address: string | null;
  bvn: string | null;
  nin: string | null;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  full_name: string;
};

export function KycForm({ investor }: { investor: Investor }) {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      phone: investor.phone ?? "",
      address: investor.address ?? "",
      bvn: investor.bvn ?? "",
      nin: investor.nin ?? "",
      bank_name: investor.bank_name ?? "",
      account_name: investor.account_name ?? investor.full_name,
      account_number: investor.account_number ?? "",
    },
  });

  const onSubmit = async (data: FormData) => {
    const res = await fetch("/api/investor/kyc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, nin: data.nin || null }),
    });
    const json = await res.json();

    if (!res.ok) {
      toast.error(json.error ?? "Failed to submit KYC. Please try again.");
      return;
    }

    toast.success("KYC submitted — welcome to your MaalGrow portal");
    router.replace("/dashboard");
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Contact */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted border-b border-border pb-2">
          Contact Details
        </h2>
        <Input
          {...register("phone")}
          label="Phone Number"
          placeholder="0803 123 4567"
          error={errors.phone?.message}
          required
        />
        <Input
          {...register("address")}
          label="Residential Address"
          placeholder="House number, street, city, state"
          error={errors.address?.message}
          required
        />
      </div>

      {/* Identity */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted border-b border-border pb-2">
          Identity Verification
        </h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <Input
            {...register("bvn")}
            label="BVN (Bank Verification Number)"
            placeholder="11 digits"
            maxLength={11}
            inputMode="numeric"
            error={errors.bvn?.message}
            required
          />
          <Input
            {...register("nin")}
            label="NIN (optional)"
            placeholder="11 digits"
            maxLength={11}
            inputMode="numeric"
            error={errors.nin?.message}
          />
        </div>
      </div>

      {/* Bank details */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted border-b border-border pb-2">
          Bank Account for Payouts
        </h2>
        <Input
          {...register("bank_name")}
          label="Bank Name"
          placeholder="e.g. Access Bank"
          error={errors.bank_name?.message}
          required
        />
        <div className="grid sm:grid-cols-2 gap-3">
          <Input
            {...register("account_name")}
            label="Account Name"
            placeholder="As it appears on your account"
            error={errors.account_name?.message}
            required
          />
          <Input
            {...register("account_number")}
            label="Account Number"
            placeholder="10 digits"
            maxLength={10}
            inputMode="numeric"
            error={errors.account_number?.message}
            required
          />
        </div>
        <p className="text-xs text-muted">
          Profit and capital payments are made only to this account, which must be in
          your own name.
        </p>
      </div>

      <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
        {isSubmitting ? "Submitting…" : "Submit KYC & Enter Portal"}
      </Button>
    </form>
  );
}
