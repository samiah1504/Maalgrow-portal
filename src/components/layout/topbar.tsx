"use client";

import { Menu, Bell, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface TopbarProps {
  title?: string;
  subtitle?: string;
  onMenuClick?: () => void;
  unreadNotifications?: number;
  userName?: string;
  userAvatar?: string;
  notificationHref?: string;
  className?: string;
}

export function Topbar({
  title,
  subtitle,
  onMenuClick,
  unreadNotifications = 0,
  userName,
  className,
}: TopbarProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-white/90 backdrop-blur-sm px-4 lg:px-6",
        className
      )}
    >
      {/* Mobile menu button */}
      <button
        onClick={onMenuClick}
        className="rounded-lg p-2 text-muted hover:bg-primary-50 hover:text-primary-700 transition-colors lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Page title */}
      <div className="flex-1 min-w-0">
        {title && (
          <h1 className="text-base font-semibold text-foreground truncate">{title}</h1>
        )}
        {subtitle && (
          <p className="text-xs text-muted truncate">{subtitle}</p>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2">
        {/* Notification Bell */}
        <a
          href="/notifications"
          className="relative rounded-lg p-2 text-muted hover:bg-primary-50 hover:text-primary-700 transition-colors"
        >
          <Bell className="h-5 w-5" />
          {/* Red, not gold. Gold is this portal's decorative colour —
              it is on the logo, the badges and the maturity banner —
              so an unread count in gold read as ornament rather than
              as something waiting to be looked at. */}
          {unreadNotifications > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white ring-2 ring-surface">
              {unreadNotifications > 9 ? "9+" : unreadNotifications}
            </span>
          )}
        </a>

        {/* Avatar */}
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-xs font-bold">
          {userName
            ? userName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
            : "?"}
        </div>
      </div>
    </header>
  );
}
