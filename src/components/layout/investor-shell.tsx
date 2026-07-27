"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { InvestorSidebar } from "@/components/layout/investor-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { createClient } from "@/lib/supabase/client";

export function InvestorShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userName, setUserName] = useState<string>("");
  const [unreadCount, setUnreadCount] = useState(0);

  /*
   * Recounted on every navigation, not once on mount.
   *
   * The notifications page marks things read through its own client,
   * with its own state — this shell never hears about it. Counting
   * only at mount meant the badge kept its number after everything
   * had been read, until a full page reload. Navigating away and back
   * now settles it, which is what anybody would expect after tapping
   * "mark all as read".
   */
  const pathname = usePathname();

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .single();

      if (profile?.full_name && !cancelled) setUserName(profile.full_name);

      const { count } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_read", false);

      if (!cancelled) setUnreadCount(count ?? 0);

      // Filtered to this user. Without the filter every INSERT on the
      // table bumped the badge, so an announcement to somebody else
      // could light up a bell with nothing behind it.
      const channel = supabase
        .channel(`notifications:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          () => setUnreadCount((prev) => prev + 1)
        )
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    };

    const teardown = load();
    return () => {
      cancelled = true;
      void teardown.then((fn) => fn?.());
    };
  }, [pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <InvestorSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        unreadNotifications={unreadCount}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          onMenuClick={() => setSidebarOpen(true)}
          unreadNotifications={unreadCount}
          userName={userName}
        />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
