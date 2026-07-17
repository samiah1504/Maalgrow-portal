import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function RootPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; token_hash?: string; type?: string }>;
}) {
  const params = await searchParams;

  // Invite / magic-link emails redirect here with a code — forward to callback
  if (params.code) {
    redirect(`/api/auth/callback?code=${params.code}`);
  }
  if (params.token_hash && params.type) {
    redirect(`/api/auth/callback?token_hash=${params.token_hash}&type=${params.type}`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const isAdmin = ["super_admin", "administrator", "finance", "operations", "customer_support"].includes(
    profile?.role ?? ""
  );

  redirect(isAdmin ? "/admin/dashboard" : "/dashboard");
}
