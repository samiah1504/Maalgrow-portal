import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole } from "@/lib/home-for-role";
import { MAALRISE_PAY_ROLES } from "./permissions";

/**
 * The MaalRise payment screen is the one MaalRise page the Payment
 * Officer opens, so it cannot use requireAdminPage (which sends that
 * role to the MaalGrow queue). Payment Officer, administrators and
 * super admins only; everyone else is sent where they belong. The
 * database's own policies still decide what each of them can read.
 */
export async function requireMaalrisePaymentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const role = (profile?.role as string | undefined) ?? "";
  if (!(MAALRISE_PAY_ROLES as readonly string[]).includes(role)) {
    redirect(isAdminRole(role) ? "/admin/maalrise/dashboard" : "/dashboard");
  }
  return { supabase, user, role };
}
