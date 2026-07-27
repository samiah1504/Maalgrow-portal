"use client";

import { useState, useEffect } from "react";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { createClient } from "@/lib/supabase/client";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userName, setUserName] = useState<string>("");
  const [role, setRole] = useState<string | null>(null);
  const [pendingPayments, setPendingPayments] = useState(0);

  useEffect(() => {
    const supabase = createClient();

    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", user.id)
        .single();

      if (profile?.full_name) setUserName(profile.full_name);
      if (profile?.role) setRole(profile.role);

      // Through the RPC, not a direct count: a Payment Officer has no
      // SELECT policy on payment_requests at all, so a table query
      // would silently return zero for the one person who most needs
      // the badge. The function checks the role from inside.
      const { data: counts } = await supabase.rpc("payment_request_counts");
      const c = (counts ?? {}) as Record<string, number>;
      // An officer cannot approve, so what is waiting on THEM is the
      // approved queue. Everyone else is looking at what needs a
      // decision.
      setPendingPayments(
        profile?.role === "payment_officer"
          ? c.approved ?? 0
          : c.pending ?? 0
      );
    };

    load();
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AdminSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        pendingPayments={pendingPayments}
        role={role}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          onMenuClick={() => setSidebarOpen(true)}
          userName={userName}
        />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
