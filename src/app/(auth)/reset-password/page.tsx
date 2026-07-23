"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Lock, CheckCircle2, AlertCircle, MailQuestion } from "lucide-react";
import { toast } from "sonner";
import type { EmailOtpType } from "@supabase/supabase-js";
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

const OTP_TYPES: EmailOtpType[] = [
  "invite",
  "recovery",
  "signup",
  "magiclink",
  "email_change",
  "email",
];

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [success, setSuccess] = useState(false);
  const [expired, setExpired] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialised = useRef(false);

  // Link format we email: /reset-password?token_hash=...&type=invite|recovery
  // The token is redeemed ONLY when the investor presses the button, so
  // link scanners and WhatsApp previews can no longer burn it.
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  const otpType: EmailOtpType = OTP_TYPES.includes(rawType as EmailOtpType)
    ? (rawType as EmailOtpType)
    : "recovery";

  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;

    const supabase = createClient();
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const hashParams = new URLSearchParams(hash.replace(/^#/, ""));

    // Legacy Supabase-hosted links redirect here with an error in the
    // fragment when the one-time token was already used or expired.
    const errCode = hashParams.get("error_code");
    const errDesc = hashParams.get("error_description");
    if (errCode || hashParams.get("error")) {
      setExpired(
        errCode === "otp_expired"
          ? "This link has expired or was already used."
          : errDesc?.replace(/\+/g, " ") ?? "This link is no longer valid."
      );
      return;
    }

    // Legacy links that DID verify arrive with session tokens in the
    // fragment — establish the session explicitly instead of hoping
    // the client picks it up.
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    if (accessToken && refreshToken) {
      supabase.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error }) => {
          if (!error) {
            setHasSession(true);
            window.history.replaceState(null, "", window.location.pathname);
          } else if (!tokenHash) {
            setExpired("This link is no longer valid.");
          }
        });
      return;
    }

    // Already signed in (e.g. changing password mid-session)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setHasSession(true);
      else if (!tokenHash) {
        setExpired(
          "This page can only be opened from the link in your invitation or password-reset email."
        );
      }
    });
  }, [tokenHash]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setFormError(null);
    const supabase = createClient();

    // Redeem the one-time token now, at the moment of the click.
    if (!hasSession && tokenHash) {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        type: otpType,
        token_hash: tokenHash,
      });
      if (verifyError) {
        setExpired(
          "This link has expired or was already used. Request a fresh one below."
        );
        return;
      }
      setHasSession(true);
    }

    const { error } = await supabase.auth.updateUser({ password: data.password });

    if (error) {
      const msg = error.message?.toLowerCase() ?? "";
      if (msg.includes("different from the old")) {
        setFormError("Your new password must be different from your current password.");
      } else if (msg.includes("session") || msg.includes("not logged in")) {
        setExpired("Your session could not be verified. Request a fresh link below.");
      } else {
        setFormError(error.message || "Failed to set the password. Please try again.");
      }
      return;
    }

    setSuccess(true);
    toast.success("Password set successfully");
    // verifyOtp signed them in — take them straight into the portal
    setTimeout(() => {
      window.location.href = "/dashboard";
    }, 2000);
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
                {expired ? (
                  <MailQuestion className="h-7 w-7 text-amber-500" />
                ) : (
                  <Lock className="h-7 w-7 text-primary-700" />
                )}
              </div>
            </div>
            <h1 className="text-xl font-bold text-foreground">
              {expired ? "Link No Longer Valid" : "Set Your Password"}
            </h1>
            <p className="text-sm text-muted mt-1">
              {expired
                ? "Don't worry — you can get a fresh one"
                : success
                ? "Password set successfully"
                : "Choose a strong, secure password"}
            </p>
          </div>

          <div className="px-8 py-8">
            {expired ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-amber-800">{expired}</p>
                </div>
                <p className="text-sm text-muted">
                  Enter your registered email on the next page and we&apos;ll
                  send you a fresh password link right away.
                </p>
                <Link href="/forgot-password">
                  <Button className="w-full" size="lg">
                    Request a New Link
                  </Button>
                </Link>
                <p className="text-center text-xs text-muted">
                  Already have a password?{" "}
                  <Link href="/login" className="text-primary-600 hover:underline">
                    Sign in
                  </Link>
                </p>
              </div>
            ) : success ? (
              <div className="text-center space-y-4">
                <div className="flex justify-center">
                  <CheckCircle2 className="h-16 w-16 text-success" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Password set!</p>
                  <p className="text-sm text-muted mt-2">
                    Taking you to your portal...
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

                {formError && (
                  <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-red-700">{formError}</p>
                  </div>
                )}

                <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
                  {isSubmitting ? "Setting password..." : "Set New Password"}
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
