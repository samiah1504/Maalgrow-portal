import type { Database } from "./database.types";

export type { Database };

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Investor = Database["public"]["Tables"]["investors"]["Row"];
export type Series = Database["public"]["Tables"]["series"]["Row"];
export type Cycle = Database["public"]["Tables"]["cycles"]["Row"];
export type Investment = Database["public"]["Tables"]["investments"]["Row"];
export type PaymentRequest = Database["public"]["Tables"]["payment_requests"]["Row"];
export type Notification = Database["public"]["Tables"]["notifications"]["Row"];
export type Document = Database["public"]["Tables"]["documents"]["Row"];
export type AuditLog = Database["public"]["Tables"]["audit_logs"]["Row"];
export type Announcement = Database["public"]["Tables"]["announcements"]["Row"];
export type CycleProfitDeclaration = Database["public"]["Tables"]["cycle_profit_declarations"]["Row"];

export type UserRole =
  | "super_admin"
  | "administrator"
  | "finance"
  | "operations"
  | "customer_support"
  | "investor";

export type InvestmentStatus = "active" | "matured" | "completed";
export type PaymentStatus = "pending" | "approved" | "processing" | "paid" | "rejected";
export type KycStatus = "pending" | "approved" | "rejected";
export type SeriesName = "A" | "B" | "C";
export type CycleStatus = "upcoming" | "active" | "awaiting_profit_declaration" | "matured" | "completed";
export type PaymentType = "roi" | "capital";
export type NotificationType =
  | "investment"
  | "roi"
  | "capital"
  | "maturity"
  | "payment"
  | "document"
  | "announcement"
  | "system";
export type DocumentType = "agreement" | "certificate" | "statement" | "receipt" | "report" | "other";
export type MaturityDecision = "continue" | "exit";

// Extended types with joined data
export interface InvestmentWithDetails extends Investment {
  investor?: Investor & { profile?: Profile };
  series?: Series;
  cycle?: Cycle;
  payment_requests?: PaymentRequest[];
}

export interface InvestorWithProfile extends Investor {
  profile?: Profile;
  active_investments_count?: number;
  total_capital?: number;
  total_profit_received?: number;
}

export interface PaymentRequestWithDetails extends PaymentRequest {
  investor?: Investor & { profile?: Profile };
  investment?: Investment & { series?: Series; cycle?: Cycle };
}

export interface NotificationWithMeta extends Notification {
  relative_time?: string;
}

export interface CycleWithSeries extends Cycle {
  series?: Series;
  investments_count?: number;
}

// Dashboard stats
export interface InvestorDashboardStats {
  total_active_capital: number;
  total_profit_received: number;
  total_capital_returned: number;
  active_investments: number;
  upcoming_maturities: number;
  series_breakdown: {
    series: SeriesName;
    status: "active" | "inactive";
    capital: number;
    declared_profit: number | null;
  }[];
}

export interface AdminDashboardStats {
  total_investors: number;
  total_active_investments: number;
  total_capital_under_management: number;
  total_profit_paid: number;
  pending_payment_requests: number;
  maturing_this_month: number;
  new_investors_this_month: number;
  cycles_awaiting_declaration: number;
  series_stats: {
    series: SeriesName;
    active_investors: number;
    total_capital: number;
    current_cycle: string;
  }[];
}

// Form types
export interface MaturityDecisionFormData {
  decision: MaturityDecision;
  bank_name: string;
  account_name: string;
  account_number: string;
  notes?: string;
}

export interface InvestmentFormData {
  investor_id: string;
  series_id: string;
  cycle_id: string;
  units: number;
  investment_date: string;
  notes?: string;
}

export interface PaymentApprovalData {
  status: "approved" | "rejected";
  rejection_reason?: string;
  paid_at?: string;
}

// API Response types
export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Navigation
export interface NavItem {
  label: string;
  href: string;
  icon: string;
  badge?: number;
  children?: NavItem[];
}
