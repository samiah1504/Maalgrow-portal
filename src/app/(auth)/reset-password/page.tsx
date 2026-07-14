"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Lock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const schema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Must contain at least one uppercase letter")
      .regex(/[0-9]/, "Must contain at least one number"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type FormData = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    const supabase = createClient();

    const { error } = await supabase.auth.updateUser({ password: data.password });

    if (error) {
      toast.error("Failed to reset password. The link may have expired.");
      return;
    }

    setSuccess(true);
    toast.success("Password reset successfully");
    setTimeout(() => router.push("/login"), 3000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-900 via-primary-700 to-primary-800 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-gold-500/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-slide-up">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-8 pt-8 pb-6 text-center border-b border-border">
            <div className="flex justify-center mb-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50">
                <Lock className="h-7 w-7 text-primary-700" />
              </div>
            </div>
            <h1 className="text-xl font-bold text-foreground">New Password</h1>
            <p className="text-sm text-muted mt-1">
              {success ? "Password updated successfully" : "Choose a strong, secure password"}
            </p>
          </div>

          <div className="px-8 py-8">
            {success ? (
              <div className="text-center space-y-4">
                <div className="flex justify-center">
                  <CheckCircle2 className="h-16 w-16 text-success" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Password updated!</p>
                  <p className="text-sm text-muted mt-2">
                    Redirecting you to sign in...
                  </p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <Input
                  {...register("password")}
                  type={showPassword ? "text" : "password"}
                  label="New Password"
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  error={errors.password?.message}
                  leftIcon={<Lock className="h-4 w-4" />}
                  rightIcon={
                    <button type="button" onClick={() => setShowPassword(!showPassword)}>
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  }
                  required
                />
                <Input
                  {...register("confirmPassword")}
                  type={showConfirm ? "text" : "password"}
                  label="Confirm Password"
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  error={errors.confirmPassword?.message}
                  leftIcon={<Lock className="h-4 w-4" />}
                  rightIcon={
                    <button type="button" onClick={() => setShowConfirm(!showConfirm)}>
                      {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  }
                  required
                />

                <div className="rounded-lg bg-primary-50 border border-primary-100 p-3">
                  <p className="text-xs font-medium text-primary-700 mb-1">Password requirements:</p>
                  <ul className="text-xs text-primary-600 space-y-0.5">
                    <li>• At least 8 characters long</li>
                    <li>• At least one uppercase letter (A-Z)</li>
                    <li>• At least one number (0-9)</li>
                  </ul>
                </div>

                <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
                  {isSubmitting ? "Updating..." : "Set New Password"}
                </Button>
              </form>
            )}
          </div>
        </div>
        <p className="text-center text-xs text-white/50 mt-6">
          © {new Date().getFullYear()} MaalVest Investment Limited
        </p>
      </div>
    </div>
  );
}
