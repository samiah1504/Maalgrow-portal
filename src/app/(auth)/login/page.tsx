"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import Image from "next/image";
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

// Safely extract a string message from any thrown value.
// Error.message is non-enumerable so JSON.stringify(error) returns {} —
// this function reads the property directly instead.
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  if (typeof error === "string") return error;
  return "";
}

function mapToUserMessage(raw: string): string {
  const msg = raw.toLowerCase();

  if (!raw || raw === "{}" || raw === "[]" || raw.trim() === "") {
    return "Unable to sign in. Please try again or contact support.";
  }
  if (msg.includes("invalid login credentials")) {
    return "The email address or password is incorrect.";
  }
  if (msg.includes("email not confirmed")) {
    return "Please confirm your email address before signing in.";
  }
  if (msg.includes("too many requests") || msg.includes("rate limit")) {
    return "Too many sign-in attempts. Please wait a few minutes and try again.";
  }
  if (msg.includes("profile") || msg.includes("investor")) {
    return "Your login succeeded, but your investor profile could not be found. Please contact support.";
  }
  if (msg.includes("permission") || msg.includes("row-level security") || msg.includes("rls")) {
    return "Your account does not currently have permission to access the portal.";
  }
  // Return raw if it looks like a real readable message; otherwise fallback
  if (raw.length > 0 && raw !== "{}") return raw;
  return "Unable to sign in. Please try again or contact support.";
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
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

    // Stage 0 — env var diagnostic (never prints actual values)
    console.log("[Login] env check", {
      hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      hasAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    });

    const supabase = createClient();
    const email = data.email.trim().toLowerCase();

    // Stage 1 — password authentication
    let signInData: { user: unknown; session: unknown } | null = null;
    let signInError: unknown = null;

    try {
      const { data: d, error: e } = await supabase.auth.signInWithPassword({
        email,
        password: data.password,
      });
      signInData = d;
      signInError = e;

      console.log("[Login] AUTH RESULT", {
        hasUser: Boolean(d?.user),
        hasSession: Boolean(d?.session),
        errorMessage: getErrorMessage(e),
        errorStatus: (e as { status?: unknown } | null)?.status,
        errorCode: (e as { code?: unknown } | null)?.code,
      });
    } catch (err: unknown) {
      console.error("[Login] AUTH FAILURE (thrown)", {
        name: typeof err === "object" && err !== null && "name" in err ? (err as { name?: unknown }).name : undefined,
        message: getErrorMessage(err),
        status: typeof err === "object" && err !== null && "status" in err ? (err as { status?: unknown }).status : undefined,
        code: typeof err === "object" && err !== null && "code" in err ? (err as { code?: unknown }).code : undefined,
      });
      setLoginError("Unable to connect to the authentication service. Please check your internet connection.");
      return;
    }

    if (signInError) {
      console.error("[Login] AUTH FAILURE (returned error)", {
        name: typeof signInError === "object" && signInError !== null && "name" in signInError
          ? (signInError as { name?: unknown }).name : undefined,
        message: getErrorMessage(signInError),
        status: typeof signInError === "object" && signInError !== null && "status" in signInError
          ? (signInError as { status?: unknown }).status : undefined,
        code: typeof signInError === "object" && signInError !== null && "code" in signInError
          ? (signInError as { code?: unknown }).code : undefined,
      });
      setLoginError(mapToUserMessage(getErrorMessage(signInError)));
      return;
    }

    if (!signInData?.user) {
      console.error("[Login] AUTH FAILURE: no user in response", { signInData });
      setLoginError("Sign-in succeeded but no user was returned. Please try again.");
      return;
    }

    // Stage 2 — re-fetch authenticated user to confirm session
    const { data: { user }, error: getUserError } = await supabase.auth.getUser();
    console.log("[Login] GET USER", {
      hasUser: Boolean(user),
      userId: user?.id,
      error: getErrorMessage(getUserError),
    });

    if (getUserError || !user) {
      setLoginError("Session could not be established. Please try again.");
      return;
    }

    // Stage 3 — profile lookup
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    console.log("[Login] PROFILE RESULT", {
      hasProfile: Boolean(profile),
      role: profile?.role,
      errorMessage: profileError ? getErrorMessage(profileError) : null,
      errorCode: profileError?.code,
    });

    if (profileError || !profile) {
      setLoginError(
        profileError
          ? mapToUserMessage(getErrorMessage(profileError))
          : "Your investor profile could not be found. Please contact support."
      );
      return;
    }

    // Stage 4 — role check and redirect
    const isAdmin = ["super_admin", "administrator", "finance", "operations", "customer_support"].includes(
      profile.role ?? ""
    );
    const destination = isAdmin ? "/admin/dashboard" : redirectTo;

    console.log("[Login] REDIRECT", { role: profile.role, isAdmin, destination });

    toast.success("Welcome back!");
    window.location.href = destination;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-900 via-primary-700 to-primary-800 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-gold-500/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-slide-up">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-primary-700 to-primary-800 px-8 pt-8 pb-6 text-center">
            <div className="flex justify-center mb-4">
              <Image
                src="/logo.png"
                alt="MaalGrow"
                width={88}
                height={88}
                priority
                className="h-22 w-22 rounded-2xl shadow-lg"
              />
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

              {/* Single error location — inline, always visible */}
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

        <p className="text-center text-xs text-white/50 mt-6">
          © {new Date().getFullYear()} MaalVest Investment Limited · All rights reserved
        </p>
      </div>
    </div>
  );
}
