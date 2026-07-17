"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Lock, Mail, TrendingUp, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const schema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function mapAuthError(error: { message?: string }): string {
  const raw = error.message ?? "";
  const msg = raw.toLowerCase().trim();

  // Empty body or "{}" means the Supabase project is paused or misconfigured
  if (!msg || msg === "{}" || msg === "[]") {
    return "Authentication service is temporarily unavailable. If this persists, the database may be paused — please contact support.";
  }
  if (msg.includes("invalid login credentials") || msg.includes("invalid email or password") || msg.includes("user not found")) {
    return "Invalid email or password. Please check your details and try again.";
  }
  if (msg.includes("email not confirmed")) {
    return "Your email address has not been confirmed. Please check your inbox for a confirmation link.";
  }
  if (msg.includes("too many requests") || msg.includes("rate limit")) {
    return "Too many sign-in attempts. Please wait a few minutes and try again.";
  }
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("failed to fetch") || msg.includes("load failed")) {
    return "Unable to connect to authentication service. Please check your internet connection and try again.";
  }
  return raw || "An unexpected error occurred. Please try again.";
}

function LoginForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/dashboard";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setLoginError(null);
    const supabase = createClient();

    let authError: { message?: string } | null = null;
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: data.email.trim().toLowerCase(),
        password: data.password,
      });
      authError = error;
    } catch {
      const message = "Unable to connect to authentication service. Please check your internet connection and try again.";
      setLoginError(message);
      toast.error(message);
      return;
    }

    if (authError) {
      const message = mapAuthError(authError);
      setLoginError(message);
      toast.error(message);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const message = "Unable to retrieve account details. Please try again.";
      setLoginError(message);
      toast.error(message);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      const message = "Account profile not found. Please contact support at support@maalvest.com.";
      setLoginError(message);
      toast.error(message);
      return;
    }

    const isAdmin = ["super_admin", "administrator", "finance", "operations", "customer_support"].includes(
      profile.role ?? ""
    );

    toast.success("Welcome back!");
    window.location.href = isAdmin ? "/admin/dashboard" : redirectTo;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-900 via-primary-700 to-primary-800 flex items-center justify-center p-4">
      {/* Background Pattern */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-gold-500/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-slide-up">
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-primary-700 to-primary-800 px-8 pt-8 pb-6 text-center">
            <div className="flex justify-center mb-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gold-500 shadow-lg">
                <TrendingUp className="h-8 w-8 text-primary-900" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-white">MaalGrow</h1>
            <p className="text-primary-200 text-sm mt-1">MaalVest Investment Limited</p>
            <div className="mt-3 inline-flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1">
              <div className="h-1.5 w-1.5 rounded-full bg-gold-400 animate-pulse" />
              <span className="text-xs text-white/90">Shariah-Compliant Mudārabah</span>
            </div>
          </div>

          {/* Form */}
          <div className="px-8 py-8">
            <div className="mb-6 text-center">
              <h2 className="text-xl font-semibold text-foreground">Investor Sign In</h2>
              <p className="text-sm text-muted mt-1">Access your secure investment portal</p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <Input
                {...register("email")}
                type="email"
                label="Email Address"
                placeholder="you@example.com"
                autoComplete="email"
                error={errors.email?.message}
                leftIcon={<Mail className="h-4 w-4" />}
                required
              />

              <div className="space-y-1.5">
                <Input
                  {...register("password")}
                  type={showPassword ? "text" : "password"}
                  label="Password"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  error={errors.password?.message}
                  leftIcon={<Lock className="h-4 w-4" />}
                  rightIcon={
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-muted hover:text-foreground transition-colors"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  }
                  required
                />
                <div className="flex justify-end">
                  <Link
                    href="/forgot-password"
                    className="text-xs text-primary-600 hover:text-primary-700 hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
              </div>

              {/* Inline error — visible even if toast is hidden */}
              {loginError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-red-700">{loginError}</p>
                </div>
              )}

              <Button
                type="submit"
                className="w-full mt-2"
                size="lg"
                loading={isSubmitting}
              >
                {isSubmitting ? "Signing in..." : "Sign In to Portal"}
              </Button>
            </form>

            {/* Security Notice */}
            <div className="mt-6 rounded-lg bg-primary-50 border border-primary-100 p-3">
              <div className="flex items-start gap-2">
                <Lock className="h-4 w-4 text-primary-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-primary-700">Secure & Private</p>
                  <p className="text-xs text-primary-600 mt-0.5">
                    This portal is for registered investors only. All sessions are encrypted and monitored.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-white/50 mt-6">
          © {new Date().getFullYear()} MaalVest Investment Limited · All rights reserved
        </p>
      </div>
    </div>
  );
}
