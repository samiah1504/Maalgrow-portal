"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  GENDER_OPTIONS,
  OCCUPATION_OPTIONS,
  RELATIONSHIP_OPTIONS,
  NATIONALITY_OPTIONS,
} from "@/lib/kyc";

const phoneRegex = /^[+\d][\d\s-]{8,}$/;

const schema = z.object({
  phone: z
    .string()
    .min(10, "Enter a valid phone number")
    .regex(phoneRegex, "Enter a valid phone number"),
  address: z.string().min(10, "Enter your full residential address"),
  nin: z
    .string()
    .regex(/^\d{11}$/, "NIN must be exactly 11 digits")
    .or(z.literal(""))
    .optional(),
  bank_name: z.string().min(2, "Enter your bank name"),
  account_name: z.string().min(3, "Enter the account name"),
  account_number: z.string().regex(/^\d{10}$/, "Account number must be 10 digits"),
  // ── New personal fields ──
  gender: z.enum(["female", "male", "prefer_not_to_say"], {
    error: "Select your gender",
  }),
  nationality: z.string().min(2, "Select or enter your nationality"),
  occupation: z.string().min(1, "Select your occupation"),
  occupation_other: z.string().optional(),
  // ── Next of kin ──
  nok_full_name: z.string().min(3, "Enter your next of kin's full name"),
  nok_relationship: z.string().min(1, "Select the relationship"),
  nok_phone: z
    .string()
    .min(10, "Enter a valid phone number")
    .regex(phoneRegex, "Enter a valid phone number"),
  nok_alternative_phone: z
    .string()
    .regex(phoneRegex, "Enter a valid phone number")
    .or(z.literal(""))
    .optional(),
  nok_email: z
    .string()
    .email("Enter a valid email address")
    .or(z.literal(""))
    .optional(),
  nok_address: z.string().min(5, "Enter their residential address"),
  nok_city: z.string().min(2, "Enter their city"),
  nok_state: z.string().min(2, "Enter their state"),
  nok_country: z.string().min(2, "Enter their country"),
});

type FormData = z.infer<typeof schema>;

type Investor = {
  phone: string | null;
  address: string | null;
  nin: string | null;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  gender: string | null;
  nationality: string | null;
  occupation: string | null;
  full_name: string;
};

type NextOfKin = {
  full_name: string;
  relationship: string;
  phone: string;
  alternative_phone: string | null;
  email: string | null;
  address: string;
  city: string;
  state: string;
  country: string;
} | null;

const selectCls =
  "h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20";

export function KycForm({
  investor,
  nextOfKin,
  isUpdate,
}: {
  investor: Investor;
  nextOfKin: NextOfKin;
  isUpdate?: boolean;
}) {
  const router = useRouter();

  const storedOccupation = investor.occupation ?? "";
  const occupationIsPreset = (OCCUPATION_OPTIONS as readonly string[]).includes(
    storedOccupation
  );

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      phone: investor.phone ?? "",
      address: investor.address ?? "",
      nin: investor.nin ?? "",
      bank_name: investor.bank_name ?? "",
      account_name: investor.account_name ?? investor.full_name,
      account_number: investor.account_number ?? "",
      gender: (investor.gender as FormData["gender"]) ?? undefined,
      nationality: investor.nationality ?? "Nigerian",
      occupation: storedOccupation
        ? occupationIsPreset
          ? storedOccupation
          : "Other"
        : "",
      occupation_other:
        storedOccupation && !occupationIsPreset ? storedOccupation : "",
      nok_full_name: nextOfKin?.full_name ?? "",
      nok_relationship: nextOfKin?.relationship ?? "",
      nok_phone: nextOfKin?.phone ?? "",
      nok_alternative_phone: nextOfKin?.alternative_phone ?? "",
      nok_email: nextOfKin?.email ?? "",
      nok_address: nextOfKin?.address ?? "",
      nok_city: nextOfKin?.city ?? "",
      nok_state: nextOfKin?.state ?? "",
      nok_country: nextOfKin?.country ?? "Nigeria",
    },
  });

  const occupationChoice = watch("occupation");

  const onSubmit = async (data: FormData) => {
    if (data.occupation === "Other" && !data.occupation_other?.trim()) {
      toast.error("Please type your occupation");
      return;
    }
    const res = await fetch("/api/investor/kyc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...data,
        nin: data.nin || null,
        occupation:
          data.occupation === "Other"
            ? data.occupation_other?.trim()
            : data.occupation,
        nok_alternative_phone: data.nok_alternative_phone || null,
        nok_email: data.nok_email || null,
      }),
    });
    const json = await res.json();

    if (!res.ok) {
      toast.error(json.error ?? "Failed to submit KYC. Please try again.");
      return;
    }

    toast.success(
      isUpdate
        ? "KYC updated — thank you"
        : "KYC submitted — welcome to your MaalGrow portal"
    );
    router.replace("/dashboard");
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Personal information */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted border-b border-border pb-2">
          Personal Information
        </h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Gender <span className="text-danger">*</span>
            </label>
            <select {...register("gender")} className={selectCls}>
              <option value="">— Select —</option>
              {GENDER_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
            {errors.gender && (
              <p className="text-xs text-danger">{errors.gender.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Nationality <span className="text-danger">*</span>
            </label>
            <input
              {...register("nationality")}
              list="kyc-nationalities"
              placeholder="Start typing…"
              className={selectCls}
            />
            <datalist id="kyc-nationalities">
              {NATIONALITY_OPTIONS.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            {errors.nationality && (
              <p className="text-xs text-danger">{errors.nationality.message}</p>
            )}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Occupation <span className="text-danger">*</span>
            </label>
            <select {...register("occupation")} className={selectCls}>
              <option value="">— Select —</option>
              {OCCUPATION_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            {errors.occupation && (
              <p className="text-xs text-danger">{errors.occupation.message}</p>
            )}
          </div>
          {occupationChoice === "Other" && (
            <Input
              {...register("occupation_other")}
              label="Please specify"
              placeholder="Your occupation"
              required
            />
          )}
        </div>
      </div>

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

      {/* Next of kin */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted border-b border-border pb-2">
          Next of Kin
        </h2>
        <Input
          {...register("nok_full_name")}
          label="Full Name"
          placeholder="Their full legal name"
          error={errors.nok_full_name?.message}
          required
        />
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Relationship to You <span className="text-danger">*</span>
            </label>
            <select {...register("nok_relationship")} className={selectCls}>
              <option value="">— Select —</option>
              {RELATIONSHIP_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {errors.nok_relationship && (
              <p className="text-xs text-danger">{errors.nok_relationship.message}</p>
            )}
          </div>
          <Input
            {...register("nok_phone")}
            label="Phone Number"
            placeholder="0803 123 4567"
            error={errors.nok_phone?.message}
            required
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Input
            {...register("nok_alternative_phone")}
            label="Alternative Phone (optional)"
            placeholder="0803 123 4567"
            error={errors.nok_alternative_phone?.message}
          />
          <Input
            {...register("nok_email")}
            label="Email Address (optional)"
            placeholder="them@example.com"
            error={errors.nok_email?.message}
          />
        </div>
        <Input
          {...register("nok_address")}
          label="Residential Address"
          placeholder="House number, street"
          error={errors.nok_address?.message}
          required
        />
        <div className="grid sm:grid-cols-3 gap-3">
          <Input
            {...register("nok_city")}
            label="City"
            error={errors.nok_city?.message}
            required
          />
          <Input
            {...register("nok_state")}
            label="State"
            error={errors.nok_state?.message}
            required
          />
          <Input
            {...register("nok_country")}
            label="Country"
            error={errors.nok_country?.message}
            required
          />
        </div>
        <p className="text-xs text-muted">
          Providing next-of-kin information does not automatically make the person a
          beneficiary or override applicable inheritance or legal arrangements.
        </p>
      </div>

      <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
        {isSubmitting
          ? "Submitting…"
          : isUpdate
          ? "Save Updates & Continue"
          : "Submit KYC & Enter Portal"}
      </Button>
    </form>
  );
}
