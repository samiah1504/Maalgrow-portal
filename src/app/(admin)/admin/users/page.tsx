import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  UserCog,
  ShieldCheck,
  Crown,
  Headphones,
  DollarSign,
  Wrench,
  CreditCard,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { STAFF_ROLE_VALUES } from "@/lib/staff-roles";
import { AddStaffButton, StaffActions, type StaffRow } from "./_staff-manager";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Users | Admin" };
export const revalidate = 0;

const roleConfig: Record<
  string,
  { label: string; icon: React.ReactNode; color: string }
> = {
  super_admin: { label: "Super Admin", icon: <Crown className="h-3.5 w-3.5" />, color: "bg-gold-100 text-gold-800" },
  administrator: { label: "Administrator", icon: <ShieldCheck className="h-3.5 w-3.5" />, color: "bg-primary-100 text-primary-800" },
  finance: { label: "Finance", icon: <DollarSign className="h-3.5 w-3.5" />, color: "bg-emerald-100 text-emerald-800" },
  operations: { label: "Operations", icon: <Wrench className="h-3.5 w-3.5" />, color: "bg-blue-100 text-blue-800" },
  customer_support: { label: "Customer Support", icon: <Headphones className="h-3.5 w-3.5" />, color: "bg-purple-100 text-purple-800" },
  payment_officer: { label: "Payment Officer", icon: <CreditCard className="h-3.5 w-3.5" />, color: "bg-teal-100 text-teal-800" },
};

export default async function AdminUsersPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  // Only a super admin manages staff — creating an account is creating
  // a way into the portal, and that is not delegated to the roles it
  // can create.
  const canManage = me?.role === "super_admin";

  // Service role for the read: a profile's own SELECT policy would
  // otherwise hide colleagues from a non-super-admin viewer, and the
  // page would look broken rather than restricted.
  const db = await createAdminClient();
  const { data: rawUsers } = await db
    .from("profiles")
    .select("id, full_name, email, role, is_active, created_at")
    .in("role", STAFF_ROLE_VALUES)
    .order("created_at", { ascending: false });

  const users = (rawUsers ?? []) as StaffRow[];

  const roleGroups: Record<string, StaffRow[]> = {};
  for (const u of users) {
    (roleGroups[u.role] ??= []).push(u);
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Users</h1>
          <p className="text-sm text-muted mt-1">
            Staff accounts and what each one can reach
          </p>
        </div>
        <AddStaffButton canManage={canManage} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
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
          <CardTitle className="text-base">
            Staff accounts ({users.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <UserCog className="h-12 w-12 text-border mb-4" />
              <p className="font-medium text-foreground">No staff accounts yet</p>
              <p className="text-sm text-muted mt-1">
                Use “Add staff member” to invite one.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    <th className="px-4 py-3 text-left font-medium text-muted">Name</th>
                    <th className="px-4 py-3 text-left font-medium text-muted">Email</th>
                    <th className="px-4 py-3 text-left font-medium text-muted">Role</th>
                    <th className="px-4 py-3 text-left font-medium text-muted">Added</th>
                    {canManage && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map((u) => {
                    const config = roleConfig[u.role];
                    return (
                      <tr
                        key={u.id}
                        className={`transition-colors hover:bg-surface-2 ${
                          u.is_active ? "" : "opacity-55"
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div
                              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                                config?.color ?? "bg-gray-100 text-gray-700"
                              }`}
                            >
                              {u.full_name?.charAt(0) ?? "?"}
                            </div>
                            <div className="min-w-0">
                              <span className="font-medium text-foreground">
                                {u.full_name ?? "—"}
                              </span>
                              {u.id === user.id && (
                                <span className="ml-1.5 text-xs text-muted">you</span>
                              )}
                              {!u.is_active && (
                                <p className="text-[11px] text-danger">Deactivated</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted">{u.email}</td>
                        <td className="px-4 py-3">
                          {config ? (
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${config.color}`}
                            >
                              {config.icon}
                              {config.label}
                            </span>
                          ) : (
                            <span className="text-xs text-muted capitalize">{u.role}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted">{formatDate(u.created_at)}</td>
                        {canManage && (
                          <td className="px-4 py-3">
                            <StaffActions
                              staff={u}
                              canManage={canManage}
                              isSelf={u.id === user.id}
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {!canManage && (
        <div className="rounded-xl border border-border bg-surface-2 p-4">
          <p className="text-sm text-muted">
            Only a super admin can add, deactivate or change the role of a staff
            account.
          </p>
        </div>
      )}
    </div>
  );
}
