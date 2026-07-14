"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  TrendingUp,
  Layers,
  RefreshCw,
  CreditCard,
  BarChart3,
  FileText,
  Megaphone,
  Shield,
  Settings,
  UserCog,
  LogOut,
  X,
  ChevronRight,
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

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/admin/dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: "Investors & Investments",
    items: [
      { label: "Investors", href: "/admin/investors", icon: <Users className="h-4 w-4" /> },
      { label: "Investments", href: "/admin/investments", icon: <TrendingUp className="h-4 w-4" /> },
    ],
  },
  {
    label: "Series & Cycles",
    items: [
      { label: "Series", href: "/admin/series", icon: <Layers className="h-4 w-4" /> },
      { label: "Cycles", href: "/admin/cycles", icon: <RefreshCw className="h-4 w-4" /> },
    ],
  },
  {
    label: "Payments & Finance",
    items: [
      { label: "Payment Requests", href: "/admin/payment-requests", icon: <CreditCard className="h-4 w-4" /> },
      { label: "Reports", href: "/admin/reports", icon: <BarChart3 className="h-4 w-4" /> },
    ],
  },
  {
    label: "Content & Compliance",
    items: [
      { label: "Documents", href: "/admin/documents", icon: <FileText className="h-4 w-4" /> },
      { label: "Announcements", href: "/admin/announcements", icon: <Megaphone className="h-4 w-4" /> },
      { label: "Audit Logs", href: "/admin/audit-logs", icon: <Shield className="h-4 w-4" /> },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Users", href: "/admin/users", icon: <UserCog className="h-4 w-4" /> },
      { label: "Settings", href: "/admin/settings", icon: <Settings className="h-4 w-4" /> },
    ],
  },
];

interface AdminSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  pendingPayments?: number;
}

export function AdminSidebar({ isOpen, onClose, pendingPayments = 0 }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    toast.success("Signed out successfully");
    router.push("/login");
  };

  const isActive = (href: string) => pathname.startsWith(href);

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={onClose} />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-primary-900 text-white transition-transform duration-300 lg:static lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between px-4 border-b border-primary-700">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold-500">
              <span className="text-xs font-black text-primary-900">MV</span>
            </div>
            <div>
              <p className="text-sm font-bold tracking-wide">MaalVest</p>
              <p className="text-[10px] text-primary-400 -mt-0.5">Admin Portal</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-primary-400 hover:bg-primary-700 hover:text-white lg:hidden transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-primary-500">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                        active
                          ? "bg-primary-600/70 text-white"
                          : "text-primary-300 hover:bg-primary-700/60 hover:text-white"
                      )}
                    >
                      <span className={cn(active ? "text-gold-400" : "")}>
                        {item.icon}
                      </span>
                      <span className="flex-1">{item.label}</span>
                      {item.label === "Payment Requests" && pendingPayments > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gold-500 px-1 text-[10px] font-bold text-primary-900">
                          {pendingPayments}
                        </span>
                      )}
                      {active && <ChevronRight className="h-3.5 w-3.5 text-gold-400" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Sign Out */}
        <div className="px-3 py-3 border-t border-primary-700">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-primary-300 hover:bg-primary-700/60 hover:text-white transition-all duration-150"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </button>
          <p className="mt-3 px-1 text-[10px] text-primary-600">MaalGrow v1.0.0</p>
        </div>
      </aside>
    </>
  );
}
