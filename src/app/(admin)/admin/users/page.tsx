import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { UserCog, ShieldCheck, Crown, Headphones, DollarSign, Wrench, CreditCard } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Users | Admin" };

type AdminUserRow = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  created_at: string;
  kyc_status: string;
};

const roleConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  super_admin: { label: "Super Admin", icon: <Crown className="h-3.5 w-3.5" />, color: "bg-gold-100 text-gold-800" },
  administrator: { label: "Administrator", icon: <ShieldCheck className="h-3.5 w-3.5" />, color: "bg-primary-100 text-primary-800" },
  finance: { label: "Finance", icon: <DollarSign className="h-3.5 w-3.5" />, color: "bg-emerald-100 text-emerald-800" },
  operations: { label: "Operations", icon: <Wrench className="h-3.5 w-3.5" />, color: "bg-blue-100 text-blue-800" },
  customer_support: { label: "Customer Support", icon: <Headphones className="h-3.5 w-3.5" />, color: "bg-purple-100 text-purple-800" },
  payment_officer: { label: "Payment Officer", icon: <CreditCard className="h-3.5 w-3.5" />, color: "bg-emerald-100 text-emerald-800" },
};

export default async function AdminUsersPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch admin profiles (non-investor roles)
  const { data: rawUsers } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, created_at, kyc_status")
    .in("role", ["super_admin", "administrator", "finance", "operations", "customer_support", "payment_officer"])
    .order("created_at", { ascending: false });

  const users = rawUsers as AdminUserRow[] | null;

  const roleGroups: Record<string, AdminUserRow[]> = {};
  users?.forEach((u) => {
    if (!roleGroups[u.role]) roleGroups[u.role] = [];
    roleGroups[u.role].push(u);
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Users</h1>
        <p className="text-sm text-muted mt-1">Admin accounts and role management</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        {Object.entries(roleConfig).map(([role, config]) => (
          <div key={role} className={`rounded-xl p-3 ${config.color}`}>
            <div className="flex items-center gap-1.5 mb-1">
              {config.icon}
              <span className="text-xs font-semibold">{config.label}</span>
            </div>
            <p className="text-xl font-bold">{roleGroups[role]?.length ?? 0}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Admin Users ({users?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!users || users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <UserCog className="h-12 w-12 text-border mb-4" />
              <p className="font-medium text-foreground">No admin users found</p>
              <p className="text-sm text-muted mt-1">Admin users are created via Supabase directly.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    <th className="px-4 py-3 text-left font-medium text-muted">Name</th>
                    <th className="px-4 py-3 text-left font-medium text-muted">Email</th>
                    <th className="px-4 py-3 text-left font-medium text-muted">Role</th>
                    <th className="px-4 py-3 text-left font-medium text-muted">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map((u) => {
                    const config = roleConfig[u.role];
                    return (
                      <tr key={u.id} className="hover:bg-surface-2 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${config?.color ?? "bg-gray-100 text-gray-700"}`}>
                              {u.full_name?.charAt(0) ?? "?"}
                            </div>
                            <span className="font-medium text-foreground">{u.full_name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted">{u.email}</td>
                        <td className="px-4 py-3">
                          {config ? (
                            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${config.color}`}>
                              {config.icon}
                              {config.label}
                            </span>
                          ) : (
                            <span className="text-xs text-muted capitalize">{u.role}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted">{formatDate(u.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-medium text-amber-800">Admin User Management</p>
        <p className="text-xs text-amber-700 mt-1">
          To create, disable, or change roles for admin accounts, use the Supabase dashboard directly or the admin API. Role changes take effect on next login.
        </p>
      </div>
    </div>
  );
}
