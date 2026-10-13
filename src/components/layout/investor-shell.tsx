"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { InvestorSidebar } from "@/components/layout/investor-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { createClient } from "@/lib/supabase/client";

/** MaalGrow pages a MaalRise-only investor has no use for. */
const MAALGROW_ONLY = ["/dashboard", "/investments", "/roi-history", "/payment-requests", "/documents"];

export function InvestorShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userName, setUserName] = useState<string>("");
  const [unreadCount, setUnreadCount] = useState(0);
  // Which products this person has. Until it loads (or if MaalRise is
  // not available), the portal is exactly the MaalGrow portal.
  const [products, setProducts] = useState({ maalgrow: true, maalrise: false });
  const [maalriseUnread, setMaalriseUnread] = useState(0);
  const router = useRouter();

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

      // MaalRise access, from migration 054. Any error — including the
      // function not existing yet — leaves the portal MaalGrow-only.
      try {
        const { data: access } = await supabase.rpc("maalrise_my_access" as never);
        const a = access as { maalgrow?: boolean; maalrise?: boolean } | null;
        if (a?.maalrise && !cancelled) {
          const both = { maalgrow: !!a.maalgrow, maalrise: true };
          setProducts(both);
          if (!both.maalgrow && MAALGROW_ONLY.some((r) => pathname === r || pathname.startsWith(`${r}/`))) {
            router.replace("/maalrise");
          }
          const { data: n } = await supabase.rpc("maalrise_my_notifications" as never);
          if (!cancelled) setMaalriseUnread(Number((n as { unread?: number } | null)?.unread ?? 0));
        }
      } catch {
        // Leave the portal as it is.
      }

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
  }, [pathname, router]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <InvestorSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        unreadNotifications={unreadCount}
        products={products}
        maalriseUnread={maalriseUnread}
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
