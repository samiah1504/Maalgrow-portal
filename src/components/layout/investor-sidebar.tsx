"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  BarChart3,
  CreditCard,
  Bell,
  FileText,
  MessageCircle,
  User,
  Settings,
  HelpCircle,
  LogOut,
  X,
  Layers,
  Wallet,
  UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard className="h-5 w-5" /> },
  { label: "My Investments", href: "/investments", icon: <TrendingUp className="h-5 w-5" /> },
  { label: "Profit History", href: "/roi-history", icon: <BarChart3 className="h-5 w-5" /> },
  { label: "Payment Requests", href: "/payment-requests", icon: <CreditCard className="h-5 w-5" /> },
  { label: "Notifications", href: "/notifications", icon: <Bell className="h-5 w-5" /> },
  { label: "Chat with Manager", href: "/chat", icon: <MessageCircle className="h-5 w-5" /> },
  { label: "Documents", href: "/documents", icon: <FileText className="h-5 w-5" /> },
];

/** MaalRise, for investors who hold it (migration 054). */
const maalriseNavItems: NavItem[] = [
  { label: "Overview", href: "/maalrise", icon: <LayoutDashboard className="h-5 w-5" /> },
  { label: "My Cycles", href: "/maalrise/cycles", icon: <Layers className="h-5 w-5" /> },
  { label: "Payments", href: "/maalrise/payments", icon: <Wallet className="h-5 w-5" /> },
  { label: "Alerts", href: "/maalrise/notifications", icon: <Bell className="h-5 w-5" /> },
  { label: "My Details", href: "/maalrise/profile", icon: <UserCheck className="h-5 w-5" /> },
];

const bottomNavItems: NavItem[] = [
  { label: "Profile", href: "/profile", icon: <User className="h-5 w-5" /> },
  { label: "Settings", href: "/settings", icon: <Settings className="h-5 w-5" /> },
  { label: "Support", href: "/support", icon: <HelpCircle className="h-5 w-5" /> },
];

interface InvestorSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  unreadNotifications?: number;
  /** Which products this person holds. MaalGrow-only by default. */
  products?: { maalgrow: boolean; maalrise: boolean };
  maalriseUnread?: number;
}

export function InvestorSidebar({
  isOpen,
  onClose,
  unreadNotifications = 0,
  products = { maalgrow: true, maalrise: false },
  maalriseUnread = 0,
}: InvestorSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    toast.success("Signed out successfully");
    router.push("/login");
  };

  // MaalRise pages, or a person who only holds MaalRise.
  const inMaalrise = products.maalrise && (pathname.startsWith("/maalrise") || !products.maalgrow);
  const items = inMaalrise ? maalriseNavItems : navItems;
  const badgeFor = (label: string) =>
    inMaalrise ? (label === "Alerts" ? maalriseUnread : 0) : label === "Notifications" ? unreadNotifications : 0;

  const isActive = (href: string) => {
    if (href === "/dashboard" || href === "/maalrise") return pathname === href;
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-primary-700 text-white transition-transform duration-300 lg:static lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between px-6 border-b border-primary-600">
          <div className="flex items-center gap-2">
            <Image
              src="/logo-192.png"
              alt="MaalGrow"
              width={32}
              height={32}
              className="h-8 w-8 rounded-lg"
            />
            <div>
              <p className="text-sm font-bold tracking-wide">{inMaalrise ? "MaalRise" : "MaalGrow"}</p>
              <p className="text-[10px] text-primary-300 -mt-0.5">A MaalVest Platform</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-primary-300 hover:bg-primary-600 hover:text-white lg:hidden transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Product switch: only for someone holding both */}
        {products.maalrise && products.maalgrow && (
          <div className="mx-3 mt-4 grid grid-cols-2 gap-1 rounded-lg bg-primary-800/60 p-1" role="tablist" aria-label="Product">
            {[
              { label: "MaalGrow", href: "/dashboard", on: !inMaalrise },
              { label: "MaalRise", href: "/maalrise", on: inMaalrise },
            ].map((t) => (
              <Link
                key={t.label}
                href={t.href}
                onClick={onClose}
                role="tab"
                aria-selected={t.on}
                className={cn(
                  "rounded-md px-2 py-1.5 text-center text-xs font-semibold transition-colors",
                  t.on ? "bg-white text-primary-800" : "text-primary-200 hover:text-white"
                )}
              >
                {t.label}
              </Link>
            ))}
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                isActive(item.href)
                  ? "bg-white/15 text-white"
                  : "text-primary-200 hover:bg-white/10 hover:text-white"
              )}
            >
              <span className={cn(isActive(item.href) ? "text-gold-400" : "")}>
                {item.icon}
              </span>
              <span>{item.label}</span>
              {/* Red here too — gold is decorative throughout this
                  sidebar, including the active-item icon just above. */}
              {badgeFor(item.label) > 0 && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                  {badgeFor(item.label) > 99 ? "99+" : badgeFor(item.label)}
                </span>
              )}
            </Link>
          ))}
        </nav>

        {/* Divider */}
        <div className="mx-3 border-t border-primary-600" />

        {/* Bottom Nav */}
        <div className="px-3 py-3 space-y-1">
          {bottomNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                isActive(item.href)
                  ? "bg-white/15 text-white"
                  : "text-primary-200 hover:bg-white/10 hover:text-white"
              )}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          ))}

          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-primary-200 hover:bg-white/10 hover:text-white transition-all duration-150"
          >
            <LogOut className="h-5 w-5" />
            <span>Sign Out</span>
          </button>
        </div>

        {/* Version */}
        <div className="px-6 py-3 border-t border-primary-600">
          <p className="text-[10px] text-primary-400">MaalGrow v1.0.0 · Shariah Compliant</p>
        </div>
      </aside>
    </>
  );
}
