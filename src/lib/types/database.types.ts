export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          phone: string | null;
          avatar_url: string | null;
          role: "super_admin" | "administrator" | "finance" | "operations" | "customer_support" | "investor";
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          phone?: string | null;
          avatar_url?: string | null;
          role?: "super_admin" | "administrator" | "finance" | "operations" | "customer_support" | "investor";
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          phone?: string | null;
          avatar_url?: string | null;
          role?: "super_admin" | "administrator" | "finance" | "operations" | "customer_support" | "investor";
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      investors: {
        Row: {
          id: string;
          profile_id: string;
          investor_code: string;
          full_name: string;
          email: string;
          phone: string | null;
          address: string | null;
          bvn: string | null;
          nin: string | null;
          bank_name: string | null;
          account_name: string | null;
          account_number: string | null;
          kyc_status: "pending" | "approved" | "rejected";
          kyc_notes: string | null;
          onboarded_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          investor_code: string;
          full_name: string;
          email: string;
          phone?: string | null;
          address?: string | null;
          bvn?: string | null;
          nin?: string | null;
          bank_name?: string | null;
          account_name?: string | null;
          account_number?: string | null;
          kyc_status?: "pending" | "approved" | "rejected";
          kyc_notes?: string | null;
          onboarded_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          full_name?: string;
          phone?: string | null;
          address?: string | null;
          bvn?: string | null;
          nin?: string | null;
          bank_name?: string | null;
          account_name?: string | null;
          account_number?: string | null;
          kyc_status?: "pending" | "approved" | "rejected";
          kyc_notes?: string | null;
          onboarded_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      series: {
        Row: {
          id: string;
          name: "A" | "B" | "C";
          description: string | null;
          start_month_offset: number;
          roi_rate: number;
          price_per_unit: number;
          min_units: number;
          max_units: number | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: "A" | "B" | "C";
          description?: string | null;
          start_month_offset: number;
          roi_rate: number;
          price_per_unit: number;
          min_units?: number;
          max_units?: number | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          description?: string | null;
          roi_rate?: number;
          price_per_unit?: number;
          min_units?: number;
          max_units?: number | null;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      cycles: {
        Row: {
          id: string;
          series_id: string;
          cycle_number: number;
          cycle_label: string;
          start_date: string;
          end_date: string;
          status: "upcoming" | "active" | "matured" | "completed";
          total_capital: number;
          total_investors: number;
          maturity_processed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          series_id: string;
          cycle_number: number;
          cycle_label: string;
          start_date: string;
          end_date: string;
          status?: "upcoming" | "active" | "matured" | "completed";
          total_capital?: number;
          total_investors?: number;
          maturity_processed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          cycle_label?: string;
          start_date?: string;
          end_date?: string;
          status?: "upcoming" | "active" | "matured" | "completed";
          total_capital?: number;
          total_investors?: number;
          maturity_processed_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      investments: {
        Row: {
          id: string;
          investment_code: string;
          investor_id: string;
          series_id: string;
          cycle_id: string;
          units: number;
          price_per_unit: number;
          capital: number;
          roi_rate: number;
          expected_roi: number;
          investment_date: string;
          maturity_date: string;
          status: "active" | "matured" | "completed";
          maturity_decision: "continue" | "exit" | null;
          maturity_decided_at: string | null;
          next_investment_id: string | null;
          parent_investment_id: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          investment_code: string;
          investor_id: string;
          series_id: string;
          cycle_id: string;
          units: number;
          price_per_unit: number;
          capital: number;
          roi_rate: number;
          expected_roi: number;
          investment_date: string;
          maturity_date: string;
          status?: "active" | "matured" | "completed";
          maturity_decision?: "continue" | "exit" | null;
          maturity_decided_at?: string | null;
          next_investment_id?: string | null;
          parent_investment_id?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: "active" | "matured" | "completed";
          maturity_decision?: "continue" | "exit" | null;
          maturity_decided_at?: string | null;
          next_investment_id?: string | null;
          notes?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      payment_requests: {
        Row: {
          id: string;
          request_code: string;
          investor_id: string;
          investment_id: string;
          type: "roi" | "capital";
          amount: number;
          bank_name: string;
          account_name: string;
          account_number: string;
          notes: string | null;
          status: "pending" | "approved" | "processing" | "paid" | "rejected";
          reviewed_by: string | null;
          reviewed_at: string | null;
          paid_at: string | null;
          rejection_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          request_code: string;
          investor_id: string;
          investment_id: string;
          type: "roi" | "capital";
          amount: number;
          bank_name: string;
          account_name: string;
          account_number: string;
          notes?: string | null;
          status?: "pending" | "approved" | "processing" | "paid" | "rejected";
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          paid_at?: string | null;
          rejection_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: "pending" | "approved" | "processing" | "paid" | "rejected";
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          paid_at?: string | null;
          rejection_reason?: string | null;
          notes?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          message: string;
          type: "investment" | "roi" | "capital" | "maturity" | "payment" | "document" | "announcement" | "system";
          is_read: boolean;
          action_url: string | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          message: string;
          type: "investment" | "roi" | "capital" | "maturity" | "payment" | "document" | "announcement" | "system";
          is_read?: boolean;
          action_url?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          is_read?: boolean;
        };
        Relationships: [];
      };
      documents: {
        Row: {
          id: string;
          investor_id: string | null;
          investment_id: string | null;
          type: "agreement" | "certificate" | "statement" | "receipt" | "report" | "other";
          name: string;
          file_path: string;
          file_size: number;
          mime_type: string;
          uploaded_by: string | null;
          is_visible_to_investor: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          investor_id?: string | null;
          investment_id?: string | null;
          type: "agreement" | "certificate" | "statement" | "receipt" | "report" | "other";
          name: string;
          file_path: string;
          file_size: number;
          mime_type: string;
          uploaded_by?: string | null;
          is_visible_to_investor?: boolean;
          created_at?: string;
        };
        Update: {
          name?: string;
          is_visible_to_investor?: boolean;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          user_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          old_values: Json | null;
          new_values: Json | null;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          old_values?: Json | null;
          new_values?: Json | null;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          [key: string]: never;
        };
        Relationships: [];
      };
      announcements: {
        Row: {
          id: string;
          title: string;
          content: string;
          target_audience: "all" | "investors" | "admins";
          is_published: boolean;
          published_at: string | null;
          expires_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          content: string;
          target_audience?: "all" | "investors" | "admins";
          is_published?: boolean;
          published_at?: string | null;
          expires_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string;
          content?: string;
          target_audience?: "all" | "investors" | "admins";
          is_published?: boolean;
          published_at?: string | null;
          expires_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      investment_summary: {
        Row: {
          id: string;
          investment_code: string;
          investor_name: string;
          investor_code: string;
          series_name: string;
          cycle_label: string;
          units: number;
          capital: number;
          expected_roi: number;
          investment_date: string;
          maturity_date: string;
          status: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      process_maturity_decisions: {
        Args: Record<string, never>;
        Returns: void;
      };
      process_matured_investments: {
        Args: Record<string, never>;
        Returns: void;
      };
      submit_maturity_decision: {
        Args: {
          p_investment_id: string;
          p_decision: "continue" | "exit";
          p_bank_name: string;
          p_account_name: string;
          p_account_number: string;
          p_notes?: string | null;
        };
        Returns: Json;
      };
      create_notification: {
        Args: {
          p_user_id: string;
          p_title: string;
          p_message: string;
          p_type: string;
          p_action_url?: string;
          p_metadata?: Json;
        };
        Returns: string;
      };
    };
    Enums: {
      user_role: "super_admin" | "administrator" | "finance" | "operations" | "customer_support" | "investor";
      investment_status: "active" | "matured" | "completed";
      payment_status: "pending" | "approved" | "processing" | "paid" | "rejected";
      kyc_status: "pending" | "approved" | "rejected";
      series_name: "A" | "B" | "C";
      cycle_status: "upcoming" | "active" | "matured" | "completed";
      payment_type: "roi" | "capital";
      notification_type: "investment" | "roi" | "capital" | "maturity" | "payment" | "document" | "announcement" | "system";
      document_type: "agreement" | "certificate" | "statement" | "receipt" | "report" | "other";
      target_audience: "all" | "investors" | "admins";
      maturity_decision: "continue" | "exit";
    };
  };
};
