"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  BarChart3,
  CreditCard,
  Bell,
  FileText,
  User,
  Settings,
  HelpCircle,
  LogOut,
  X,
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
  { label: "ROI History", href: "/roi-history", icon: <BarChart3 className="h-5 w-5" /> },
  { label: "Payment Requests", href: "/payment-requests", icon: <CreditCard className="h-5 w-5" /> },
  { label: "Notifications", href: "/notifications", icon: <Bell className="h-5 w-5" /> },
  { label: "Documents", href: "/documents", icon: <FileText className="h-5 w-5" /> },
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
}

export function InvestorSidebar({ isOpen, onClose, unreadNotifications = 0 }: InvestorSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    toast.success("Signed out successfully");
    router.push("/login");
  };

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === href;
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
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold-500">
              <span className="text-xs font-black text-primary-900">MV</span>
            </div>
            <div>
              <p className="text-sm font-bold tracking-wide">MaalVest</p>
              <p className="text-[10px] text-primary-300 -mt-0.5">MaalGrow</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-primary-300 hover:bg-primary-600 hover:text-white lg:hidden transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems.map((item) => (
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
              {item.label === "Notifications" && unreadNotifications > 0 && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-gold-500 px-1 text-[10px] font-bold text-primary-900">
                  {unreadNotifications > 99 ? "99+" : unreadNotifications}
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
