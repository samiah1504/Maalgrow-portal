import * as React from "react";
import { cn } from "@/lib/utils";
import { Card } from "./card";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  trend?: {
    value: number;
    label?: string;
    isPositive?: boolean;
  };
  accentColor?: "primary" | "gold" | "success" | "info";
  className?: string;
}

const accentColors = {
  primary: {
    bg: "bg-primary-50",
    icon: "bg-primary-100 text-primary-700",
    bar: "bg-primary-500",
  },
  gold: {
    bg: "bg-gold-50",
    icon: "bg-gold-100 text-gold-700",
    bar: "bg-gold-500",
  },
  success: {
    bg: "bg-emerald-50",
    icon: "bg-emerald-100 text-emerald-700",
    bar: "bg-emerald-500",
  },
  info: {
    bg: "bg-blue-50",
    icon: "bg-blue-100 text-blue-700",
    bar: "bg-blue-500",
  },
};

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  accentColor = "primary",
  className,
}: StatCardProps) {
  const colors = accentColors[accentColor];

  return (
    <Card className={cn("relative overflow-hidden", className)}>
      <div className={cn("absolute inset-y-0 left-0 w-1", colors.bar)} />
      <div className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted">{title}</p>
            <p className="text-2xl font-bold text-foreground tracking-tight">
              {value}
            </p>
            {subtitle && (
              <p className="text-xs text-muted">{subtitle}</p>
            )}
            {trend && (
              <div className="flex items-center gap-1 mt-2">
                <span
                  className={cn(
                    "flex items-center gap-0.5 text-xs font-medium",
                    trend.isPositive !== false ? "text-success" : "text-danger"
                  )}
                >
                  {trend.isPositive !== false ? (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                    </svg>
                  ) : (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                  )}
                  {trend.value}%
                </span>
                {trend.label && (
                  <span className="text-xs text-muted">{trend.label}</span>
                )}
              </div>
            )}
          </div>
          {icon && (
            <div className={cn("rounded-xl p-3", colors.icon)}>
              {icon}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
