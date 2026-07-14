"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { User, Building2, Shield, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const profileSchema = z.object({
  full_name: z.string().min(2, "Name must be at least 2 characters"),
  phone: z.string().optional(),
  address: z.string().optional(),
});

const bankSchema = z.object({
  bank_name: z.string().min(2, "Please enter your bank name"),
  account_name: z.string().min(3, "Please enter your account name"),
  account_number: z.string().min(10).max(10, "Account number must be 10 digits"),
});

type ProfileForm = z.infer<typeof profileSchema>;
type BankForm = z.infer<typeof bankSchema>;

export default function ProfilePage() {
  const [investor, setInvestor] = useState<{
    id: string;
    investor_code: string;
    full_name: string;
    email: string;
    phone: string | null;
    address: string | null;
    bank_name: string | null;
    account_name: string | null;
    account_number: string | null;
    kyc_status: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const profileForm = useForm<ProfileForm>({ resolver: zodResolver(profileSchema) });
  const bankForm = useForm<BankForm>({ resolver: zodResolver(bankSchema) });

  const supabase = createClient();

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("investors")
        .select("*")
        .eq("profile_id", user.id)
        .single();

      if (data) {
        setInvestor(data);
        profileForm.reset({
          full_name: data.full_name,
          phone: data.phone ?? "",
          address: data.address ?? "",
        });
        bankForm.reset({
          bank_name: data.bank_name ?? "",
          account_name: data.account_name ?? "",
          account_number: data.account_number ?? "",
        });
      }
      setLoading(false);
    };
    load();
  }, []);

  const onSaveProfile = async (data: ProfileForm) => {
    if (!investor) return;
    const { error } = await supabase
      .from("investors")
      .update({ full_name: data.full_name, phone: data.phone, address: data.address })
      .eq("id", investor.id);

    if (error) { toast.error("Failed to update profile"); return; }
    toast.success("Profile updated successfully");
  };

  const onSaveBank = async (data: BankForm) => {
    if (!investor) return;
    const { error } = await supabase
      .from("investors")
      .update(data)
      .eq("id", investor.id);

    if (error) { toast.error("Failed to update bank details"); return; }
    toast.success("Bank details updated successfully");
  };

  if (loading) {
    return <div className="h-48 rounded-xl bg-surface-2 animate-pulse" />;
  }

  const kycVariant: Record<string, "pending" | "approved" | "rejected"> = {
    pending: "pending",
    approved: "approved",
    rejected: "rejected",
  };

  return (
    <div className="space-y-6 max-w-2xl animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Profile</h1>
        <p className="text-sm text-muted mt-1">Manage your personal and banking information</p>
      </div>

      {/* Investor ID Card */}
      <div className="rounded-xl bg-gradient-to-r from-primary-700 to-primary-800 p-6 text-white">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-primary-300 text-xs uppercase tracking-widest">Investor ID</p>
            <p className="text-2xl font-bold mt-1 font-mono">{investor?.investor_code}</p>
            <p className="text-primary-200 mt-2">{investor?.full_name}</p>
            <p className="text-primary-300 text-sm">{investor?.email}</p>
          </div>
          <div>
            <Badge
              variant={kycVariant[investor?.kyc_status ?? "pending"]}
              className="text-xs"
            >
              KYC {(investor?.kyc_status ?? "pending").charAt(0).toUpperCase() + (investor?.kyc_status ?? "pending").slice(1)}
            </Badge>
          </div>
        </div>
      </div>

      {/* Personal Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4 text-primary-600" />
            Personal Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={profileForm.handleSubmit(onSaveProfile)} className="space-y-4">
            <Input
              {...profileForm.register("full_name")}
              label="Full Name"
              error={profileForm.formState.errors.full_name?.message}
              required
            />
            <Input
              value={investor?.email ?? ""}
              label="Email Address"
              disabled
              hint="Email cannot be changed. Contact support if needed."
            />
            <Input
              {...profileForm.register("phone")}
              label="Phone Number"
              placeholder="+234 xxx xxx xxxx"
              error={profileForm.formState.errors.phone?.message}
            />
            <div className="w-full space-y-1.5">
              <label className="block text-sm font-medium text-foreground">Address</label>
              <textarea
                {...profileForm.register("address")}
                rows={2}
                placeholder="Your residential address"
                className="flex w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" loading={profileForm.formState.isSubmitting}>
                <Save className="h-4 w-4" />
                Save Changes
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Bank Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-primary-600" />
            Bank Account Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted mb-4 p-2.5 rounded-lg bg-primary-50 border border-primary-100">
            These details will be pre-filled in your payment requests. You can update them at any time.
          </p>
          <form onSubmit={bankForm.handleSubmit(onSaveBank)} className="space-y-4">
            <Input
              {...bankForm.register("bank_name")}
              label="Bank Name"
              placeholder="e.g. Access Bank, GTBank"
              error={bankForm.formState.errors.bank_name?.message}
            />
            <Input
              {...bankForm.register("account_name")}
              label="Account Name"
              placeholder="As it appears on your bank account"
              error={bankForm.formState.errors.account_name?.message}
            />
            <Input
              {...bankForm.register("account_number")}
              label="Account Number"
              placeholder="10-digit NUBAN account number"
              maxLength={10}
              error={bankForm.formState.errors.account_number?.message}
            />
            <div className="flex justify-end">
              <Button type="submit" loading={bankForm.formState.isSubmitting}>
                <Save className="h-4 w-4" />
                Save Bank Details
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-primary-600" />
            Security
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Password</p>
              <p className="text-xs text-muted">Change your account password</p>
            </div>
            <a href="/reset-password">
              <Button variant="outline" size="sm">Change Password</Button>
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
