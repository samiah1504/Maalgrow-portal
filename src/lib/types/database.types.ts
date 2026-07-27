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
          /** Tax identification number. Optional; used only for withholding tax credit notes. */
          tin: string | null;
          bank_name: string | null;
          account_name: string | null;
          account_number: string | null;
          kyc_status: "pending" | "approved" | "rejected";
          kyc_notes: string | null;
          kyc_submitted_at: string | null;
          kyc_approved_at: string | null;
          kyc_approved_by: string | null;
          gender: string | null;
          nationality: string | null;
          occupation: string | null;
          assigned_manager_id: string | null;
          preferred_channel: "sms" | "whatsapp" | "both";
          onboarded_at: string | null;
          invitation_status: "not_sent" | "sent" | "activated" | "expired" | "failed";
          invitation_sent_at: string | null;
          invitation_expires_at: string | null;
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
          tin?: string | null;
          bank_name?: string | null;
          account_name?: string | null;
          account_number?: string | null;
          kyc_status?: "pending" | "approved" | "rejected";
          kyc_notes?: string | null;
          kyc_submitted_at?: string | null;
          preferred_channel?: "sms" | "whatsapp" | "both";
          onboarded_at?: string | null;
          invitation_status?: "not_sent" | "sent" | "activated" | "expired" | "failed";
          invitation_sent_at?: string | null;
          invitation_expires_at?: string | null;
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
          tin?: string | null;
          bank_name?: string | null;
          account_name?: string | null;
          account_number?: string | null;
          kyc_status?: "pending" | "approved" | "rejected";
          kyc_notes?: string | null;
          kyc_submitted_at?: string | null;
          kyc_approved_at?: string | null;
          kyc_approved_by?: string | null;
          gender?: string | null;
          nationality?: string | null;
          occupation?: string | null;
          assigned_manager_id?: string | null;
          preferred_channel?: "sms" | "whatsapp" | "both";
          onboarded_at?: string | null;
          invitation_status?: "not_sent" | "sent" | "activated" | "expired" | "failed";
          invitation_sent_at?: string | null;
          invitation_expires_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      chat_conversations: {
        Row: {
          id: string;
          investor_id: string;
          assigned_manager_id: string | null;
          category: string;
          related_series_id: string | null;
          related_cycle_id: string | null;
          status: "open" | "awaiting_admin" | "awaiting_investor" | "resolved" | "archived";
          priority: "normal" | "high";
          investor_unread: number;
          admin_unread: number;
          last_message_at: string | null;
          last_investor_message_at: string | null;
          last_admin_message_at: string | null;
          first_admin_reply_at: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      chat_messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string;
          sender_type: "investor" | "admin";
          body: string | null;
          attachment_path: string | null;
          attachment_name: string | null;
          attachment_mime: string | null;
          attachment_size: number | null;
          is_internal_note: boolean;
          read_at: string | null;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      chat_assignments: {
        Row: {
          id: string;
          conversation_id: string;
          assigned_from: string | null;
          assigned_to: string | null;
          assigned_by: string | null;
          reason: string | null;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      chat_quick_replies: {
        Row: {
          id: string;
          title: string;
          message: string;
          category: string | null;
          active: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          message: string;
          category?: string | null;
          active?: boolean;
          created_by?: string | null;
        };
        Update: {
          title?: string;
          message?: string;
          category?: string | null;
          active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      chat_settings: {
        Row: {
          id: boolean;
          support_notice: string;
          updated_at: string;
        };
        Insert: { id?: boolean; support_notice?: string };
        Update: { support_notice?: string; updated_at?: string };
        Relationships: [];
      };
      next_of_kin: {
        Row: {
          id: string;
          investor_id: string;
          full_name: string;
          relationship: string;
          phone: string;
          alternative_phone: string | null;
          email: string | null;
          address: string;
          city: string;
          state: string;
          country: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          investor_id: string;
          full_name: string;
          relationship: string;
          phone: string;
          alternative_phone?: string | null;
          email?: string | null;
          address: string;
          city: string;
          state: string;
          country?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          full_name?: string;
          relationship?: string;
          phone?: string;
          alternative_phone?: string | null;
          email?: string | null;
          address?: string;
          city?: string;
          state?: string;
          country?: string;
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
          mudarabah_investor_ratio: number;
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
          mudarabah_investor_ratio?: number;
          price_per_unit: number;
          min_units?: number;
          max_units?: number | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          description?: string | null;
          mudarabah_investor_ratio?: number;
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
          status: "draft" | "subscription_open" | "subscription_closed" | "upcoming" | "active" | "maturity_window" | "awaiting_profit_declaration" | "matured" | "completed" | "cancelled";
          subscription_open_date: string | null;
          subscription_close_date: string | null;
          unit_value: number | null;
          notes: string | null;
          total_capital: number;
          total_slots: number;
          total_investors: number;
          amount_received: number;
          maturity_processed_at: string | null;
          rollover_deadline: string | null;
          rollover_processed_at: string | null;
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
          status?: "draft" | "subscription_open" | "subscription_closed" | "upcoming" | "active" | "maturity_window" | "awaiting_profit_declaration" | "matured" | "completed" | "cancelled";
          subscription_open_date?: string | null;
          subscription_close_date?: string | null;
          unit_value?: number | null;
          notes?: string | null;
          total_capital?: number;
          total_slots?: number;
          total_investors?: number;
          amount_received?: number;
          maturity_processed_at?: string | null;
          rollover_deadline?: string | null;
          rollover_processed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          cycle_label?: string;
          start_date?: string;
          end_date?: string;
          status?: "draft" | "subscription_open" | "subscription_closed" | "upcoming" | "active" | "maturity_window" | "awaiting_profit_declaration" | "matured" | "completed" | "cancelled";
          subscription_open_date?: string | null;
          subscription_close_date?: string | null;
          unit_value?: number | null;
          notes?: string | null;
          total_capital?: number;
          total_slots?: number;
          total_investors?: number;
          amount_received?: number;
          maturity_processed_at?: string | null;
          rollover_deadline?: string | null;
          rollover_processed_at?: string | null;
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
          declared_profit: number | null;
          rollover_balance: number;
          investment_date: string;
          maturity_date: string;
          status: "active" | "matured" | "completed" | "cancelled";
          maturity_decision: "continue" | "exit" | "rollover_all" | "partial_exit" | null;
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
          declared_profit?: number | null;
          rollover_balance?: number;
          investment_date: string;
          maturity_date: string;
          status?: "active" | "matured" | "completed" | "cancelled";
          maturity_decision?: "continue" | "exit" | "rollover_all" | "partial_exit" | null;
          maturity_decided_at?: string | null;
          next_investment_id?: string | null;
          parent_investment_id?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: "active" | "matured" | "completed" | "cancelled";
          maturity_decision?: "continue" | "exit" | "rollover_all" | "partial_exit" | null;
          maturity_decided_at?: string | null;
          next_investment_id?: string | null;
          declared_profit?: number | null;
          units?: number;
          capital?: number;
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
      investment_payments: {
        Row: {
          id: string;
          investment_id: string | null;
          investor_id: string;
          series_id: string | null;
          cycle_id: string | null;
          amount: number;
          units: number;
          payment_date: string;
          method: string | null;
          reference: string | null;
          notes: string | null;
          status: "pending" | "confirmed" | "rejected" | "reversed";
          reversed_at: string | null;
          reversed_by: string | null;
          reversal_reason: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          investment_id?: string | null;
          investor_id: string;
          series_id?: string | null;
          cycle_id?: string | null;
          amount: number;
          units?: number;
          payment_date: string;
          method?: string | null;
          reference?: string | null;
          notes?: string | null;
          status?: "pending" | "confirmed" | "rejected" | "reversed";
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          amount?: number;
          units?: number;
          payment_date?: string;
          method?: string | null;
          reference?: string | null;
          notes?: string | null;
          status?: "pending" | "confirmed" | "rejected" | "reversed";
          reversed_at?: string | null;
          reversed_by?: string | null;
          reversal_reason?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      cycle_profit_declarations: {
        Row: {
          id: string;
          cycle_id: string;
          total_revenue: number;
          total_expenses: number;
          net_profit: number;
          investor_profit_share: number;
          company_profit_share: number;
          profit_per_slot: number;
          total_slots: number;
          notes: string | null;
          declared_by: string | null;
          declared_at: string;
        };
        Insert: {
          id?: string;
          cycle_id: string;
          total_revenue: number;
          total_expenses: number;
          net_profit: number;
          investor_profit_share: number;
          company_profit_share: number;
          profit_per_slot: number;
          total_slots: number;
          notes?: string | null;
          declared_by?: string | null;
          declared_at?: string;
        };
        Update: {
          total_revenue?: number;
          total_expenses?: number;
          net_profit?: number;
          investor_profit_share?: number;
          company_profit_share?: number;
          profit_per_slot?: number;
          total_slots?: number;
          notes?: string | null;
        };
        Relationships: [];
      };
      cycle_audit_log: {
        Row: {
          id: string;
          cycle_id: string;
          changed_by: string | null;
          changed_at: string;
          action: string;
          changes: Json;
        };
        Insert: {
          id?: string;
          cycle_id: string;
          changed_by?: string | null;
          changed_at?: string;
          action: string;
          changes?: Json;
        };
        Update: {
          [key: string]: never;
        };
        Relationships: [];
      };
      rollover_decisions: {
        Row: {
          id: string;
          investment_id: string;
          investor_id: string;
          source_cycle_id: string;
          decision: "continue" | "exit" | "rollover_all" | "partial_exit";
          slots_to_withdraw: number | null;
          bank_name: string | null;
          account_name: string | null;
          account_number: string | null;
          notes: string | null;
          deadline: string | null;
          locked: boolean;
          decided_by: string | null;
          via: string;
          submitted_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          investment_id: string;
          investor_id: string;
          source_cycle_id: string;
          decision: "continue" | "exit" | "rollover_all" | "partial_exit";
          slots_to_withdraw?: number | null;
          bank_name?: string | null;
          account_name?: string | null;
          account_number?: string | null;
          notes?: string | null;
          deadline?: string | null;
          locked?: boolean;
          decided_by?: string | null;
          via?: string;
          submitted_at?: string;
          updated_at?: string;
        };
        Update: {
          decision?: "continue" | "exit" | "rollover_all" | "partial_exit";
          bank_name?: string | null;
          account_name?: string | null;
          account_number?: string | null;
          notes?: string | null;
          deadline?: string | null;
          locked?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      cycle_rollovers: {
        Row: {
          id: string;
          investor_id: string;
          previous_investment_id: string;
          new_investment_id: string | null;
          source_cycle_id: string;
          destination_cycle_id: string | null;
          series_id: string;
          units: number | null;
          capital_rolled_over: number;
          profit_rolled_over: number;
          total_rollover_amount: number;
          rollover_balance: number;
          withdrawal_amount: number;
          slots_withdrawn: number;
          decision: "continue" | "exit" | "rollover_all" | "partial_exit";
          method: string;
          status: string;
          error: string | null;
          email_sent: boolean;
          email_error: string | null;
          rollover_date: string;
          processed_by: string | null;
        };
        Insert: {
          id?: string;
          investor_id: string;
          previous_investment_id: string;
          new_investment_id?: string | null;
          source_cycle_id: string;
          destination_cycle_id?: string | null;
          series_id: string;
          units?: number | null;
          capital_rolled_over?: number;
          profit_rolled_over?: number;
          total_rollover_amount?: number;
          rollover_balance?: number;
          withdrawal_amount?: number;
          slots_withdrawn?: number;
          decision: "continue" | "exit" | "rollover_all" | "partial_exit";
          method: string;
          status?: string;
          error?: string | null;
          email_sent?: boolean;
          email_error?: string | null;
          rollover_date?: string;
          processed_by?: string | null;
        };
        Update: {
          email_sent?: boolean;
          email_error?: string | null;
          status?: string;
          error?: string | null;
        };
        Relationships: [];
      };
      migration_batches: {
        Row: {
          id: string;
          series_id: string;
          cycle_id: string;
          source: string;
          source_name: string | null;
          status: string;
          email_mode: string;
          total_rows: number;
          imported_count: number;
          failed_count: number;
          skipped_count: number;
          uploaded_by: string | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          series_id: string;
          cycle_id: string;
          source: string;
          source_name?: string | null;
          status?: string;
          email_mode?: string;
          total_rows?: number;
          imported_count?: number;
          failed_count?: number;
          skipped_count?: number;
          uploaded_by?: string | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          status?: string;
          email_mode?: string;
          total_rows?: number;
          imported_count?: number;
          failed_count?: number;
          skipped_count?: number;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      migration_rows: {
        Row: {
          id: string;
          batch_id: string;
          row_number: number;
          full_name: string;
          phone: string | null;
          email: string | null;
          address: string | null;
          slots: number | null;
          amount_paid: number;
          payment_date: string | null;
          payment_reference: string | null;
          notes: string | null;
          status: string;
          issue: string | null;
          action: string | null;
          existing_investor_id: string | null;
          investor_id: string | null;
          investment_id: string | null;
          error: string | null;
          processed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          batch_id: string;
          row_number: number;
          full_name?: string;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          slots?: number | null;
          amount_paid?: number;
          payment_date?: string | null;
          payment_reference?: string | null;
          notes?: string | null;
          status?: string;
          issue?: string | null;
          action?: string | null;
          existing_investor_id?: string | null;
          investor_id?: string | null;
          investment_id?: string | null;
          error?: string | null;
          processed_at?: string | null;
          created_at?: string;
        };
        Update: {
          full_name?: string;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          slots?: number | null;
          amount_paid?: number;
          payment_date?: string | null;
          payment_reference?: string | null;
          notes?: string | null;
          status?: string;
          issue?: string | null;
          action?: string | null;
          existing_investor_id?: string | null;
          investor_id?: string | null;
          investment_id?: string | null;
          error?: string | null;
          processed_at?: string | null;
        };
        Relationships: [];
      };
      comm_templates: {
        Row: {
          id: string;
          name: string;
          channel: "sms" | "whatsapp" | "both" | "email";
          body: string;
          email_subject: string | null;
          email_preview_text: string | null;
          email_type: "operational" | "general";
          whatsapp_template_code: string | null;
          header_media_url: string | null;
          is_builtin: boolean;
          status: "active" | "archived";
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          channel?: "sms" | "whatsapp" | "both" | "email";
          body: string;
          email_subject?: string | null;
          email_preview_text?: string | null;
          email_type?: "operational" | "general";
          whatsapp_template_code?: string | null;
          header_media_url?: string | null;
          is_builtin?: boolean;
          status?: "active" | "archived";
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          channel?: "sms" | "whatsapp" | "both" | "email";
          body?: string;
          email_subject?: string | null;
          email_preview_text?: string | null;
          email_type?: "operational" | "general";
          whatsapp_template_code?: string | null;
          header_media_url?: string | null;
          status?: "active" | "archived";
          updated_at?: string;
        };
        Relationships: [];
      };
      comm_campaigns: {
        Row: {
          id: string;
          name: string;
          template_id: string | null;
          channel: "sms" | "whatsapp" | "both" | "whatsapp_fallback" | "email";
          message_body: string;
          recipient_group: "all_active" | "series" | "cycle" | "individual" | "kyc_incomplete" | "kyc_approved" | "portal_not_activated" | "maturity_pending" | "profit_published";
          series_id: string | null;
          respect_preferences: boolean;
          status: "draft" | "queued" | "processing" | "sent" | "partially_sent" | "failed" | "cancelled";
          total_recipients: number;
          sent_count: number;
          failed_count: number;
          skipped_count: number;
          estimated_units: number;
          estimated_cost: number;
          scheduled_for: string | null;
          cycle_id: string | null;
          email_type: "operational" | "general" | null;
          email_subject: string | null;
          email_preview_text: string | null;
          from_name: string | null;
          from_email: string | null;
          reply_to_email: string | null;
          attachment_mode: "none" | "shared";
          attachment_path: string | null;
          attachment_name: string | null;
          attachment_mime: string | null;
          attachment_size: number | null;
          delivered_count: number;
          opened_count: number;
          clicked_count: number;
          bounced_count: number;
          complained_count: number;
          created_by: string | null;
          created_at: string;
          started_at: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          template_id?: string | null;
          channel: "sms" | "whatsapp" | "both" | "whatsapp_fallback" | "email";
          message_body: string;
          recipient_group: "all_active" | "series" | "cycle" | "individual" | "kyc_incomplete" | "kyc_approved" | "portal_not_activated" | "maturity_pending" | "profit_published";
          series_id?: string | null;
          respect_preferences?: boolean;
          status?: "draft" | "queued" | "processing" | "sent" | "partially_sent" | "failed" | "cancelled";
          total_recipients?: number;
          sent_count?: number;
          failed_count?: number;
          skipped_count?: number;
          estimated_units?: number;
          estimated_cost?: number;
          scheduled_for?: string | null;
          cycle_id?: string | null;
          email_type?: "operational" | "general" | null;
          email_subject?: string | null;
          email_preview_text?: string | null;
          from_name?: string | null;
          from_email?: string | null;
          reply_to_email?: string | null;
          attachment_mode?: "none" | "shared";
          attachment_path?: string | null;
          attachment_name?: string | null;
          attachment_mime?: string | null;
          attachment_size?: number | null;
          created_by?: string | null;
          created_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Update: {
          name?: string;
          status?: "draft" | "queued" | "processing" | "sent" | "partially_sent" | "failed" | "cancelled";
          total_recipients?: number;
          sent_count?: number;
          failed_count?: number;
          skipped_count?: number;
          estimated_units?: number;
          estimated_cost?: number;
          scheduled_for?: string | null;
          delivered_count?: number;
          opened_count?: number;
          clicked_count?: number;
          bounced_count?: number;
          complained_count?: number;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      comm_recipients: {
        Row: {
          id: string;
          campaign_id: string;
          investor_id: string;
          phone_normalized: string | null;
          email_address: string | null;
          personalised_subject: string | null;
          channel_used: string | null;
          message: string;
          status: "pending" | "sent" | "failed" | "skipped";
          skip_reason: string | null;
          sms_fallback_used: boolean;
          provider_message_id: string | null;
          provider_response: Json | null;
          error: string | null;
          attempts: number;
          sent_at: string | null;
          delivered_at: string | null;
          opened_at: string | null;
          clicked_at: string | null;
          bounced_at: string | null;
          bounce_reason: string | null;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          investor_id: string;
          phone_normalized?: string | null;
          email_address?: string | null;
          personalised_subject?: string | null;
          channel_used?: string | null;
          message: string;
          status?: "pending" | "sent" | "failed" | "skipped";
          skip_reason?: string | null;
          sms_fallback_used?: boolean;
          provider_message_id?: string | null;
          provider_response?: Json | null;
          error?: string | null;
          attempts?: number;
          sent_at?: string | null;
        };
        Update: {
          phone_normalized?: string | null;
          channel_used?: string | null;
          status?: "pending" | "sent" | "failed" | "skipped";
          skip_reason?: string | null;
          sms_fallback_used?: boolean;
          provider_message_id?: string | null;
          provider_response?: Json | null;
          error?: string | null;
          attempts?: number;
          sent_at?: string | null;
          delivered_at?: string | null;
          opened_at?: string | null;
          clicked_at?: string | null;
          bounced_at?: string | null;
          bounce_reason?: string | null;
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
          declared_profit: number | null;
          rollover_balance: number;
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
        Returns: number;
      };
      submit_maturity_decision: {
        Args: {
          p_investment_id: string;
          p_decision: "continue" | "exit" | "rollover_all" | "partial_exit";
          p_bank_name: string;
          p_account_name: string;
          p_account_number: string;
          p_notes?: string | null;
        };
        Returns: Json;
      };
      create_audit_log: {
        Args: {
          p_action: string;
          p_entity_type: string;
          p_entity_id?: string | null;
          p_old_values?: Json | null;
          p_new_values?: Json | null;
          p_ip_address?: string | null;
          p_user_agent?: string | null;
        };
        Returns: string;
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
      submit_rollover_decision: {
        Args: {
          p_investment_id: string;
          p_decision: "continue" | "exit" | "rollover_all" | "partial_exit";
          p_bank_name?: string | null;
          p_account_name?: string | null;
          p_account_number?: string | null;
          p_notes?: string | null;
          p_admin_override?: boolean;
          p_slots_to_withdraw?: number | null;
        };
        Returns: Json;
      };
      process_cycle_rollover: {
        Args: {
          p_source_cycle_id: string;
          p_destination_cycle_id?: string | null;
          p_convert_profit_to_slots?: boolean;
        };
        Returns: Json;
      };
      create_next_cycle: {
        Args: { p_series_id: string };
        Returns: string;
      };
      declare_cycle_profit: {
        Args: {
          p_cycle_id: string;
          p_total_revenue: number;
          p_total_expenses: number;
          p_notes?: string | null;
        };
        Returns: Json;
      };
      record_investor_payment: {
        Args: {
          p_investor_id: string;
          p_series_id: string;
          p_cycle_id: string;
          p_amount: number;
          p_units: number | null;
          p_payment_date: string;
          p_method?: string | null;
          p_reference?: string | null;
          p_notes?: string | null;
          p_status?: "pending" | "confirmed";
          p_apply_to_outstanding?: boolean;
        };
        Returns: Json;
      };
      edit_investor_payment: {
        Args: {
          p_payment_id: string;
          p_series_id: string;
          p_cycle_id: string;
          p_amount: number;
          p_units: number | null;
          p_payment_date: string;
          p_method?: string | null;
          p_reference?: string | null;
          p_notes?: string | null;
        };
        Returns: Json;
      };
      reverse_investor_payment: {
        Args: { p_payment_id: string; p_reason: string };
        Returns: Json;
      };
      // Migration 024 — the sole write path for an enrolment's slots.
      // Refuses any edit that would leave capital and confirmed
      // payments unequal.
      set_investment_slots: {
        Args: {
          p_investment_id: string;
          p_units: number;
          p_reason?: string | null;
        };
        Returns: Json;
      };
      confirm_investor_payment: {
        Args: { p_payment_id: string };
        Returns: Json;
      };
      reject_investor_payment: {
        Args: { p_payment_id: string; p_reason?: string | null };
        Returns: Json;
      };
      kyc_missing_fields: {
        Args: { p_investor_id: string };
        Returns: string[];
      };
      bulk_approve_kyc: {
        Args: { p_investor_ids: string[] };
        Returns: Json;
      };
      chat_start_conversation: {
        Args: {
          p_category: string;
          p_body: string;
          p_related_series_id?: string | null;
          p_related_cycle_id?: string | null;
        };
        Returns: Json;
      };
      chat_send_message: {
        Args: {
          p_conversation_id: string;
          p_body: string | null;
          p_attachment_path?: string | null;
          p_attachment_name?: string | null;
          p_attachment_mime?: string | null;
          p_attachment_size?: number | null;
          p_internal_note?: boolean;
        };
        Returns: Json;
      };
      chat_mark_read: {
        Args: { p_conversation_id: string };
        Returns: undefined;
      };
      chat_update_conversation: {
        Args: {
          p_conversation_id: string;
          p_action: string;
          p_manager_id?: string | null;
          p_reason?: string | null;
        };
        Returns: Json;
      };
      chat_bulk_assign_manager: {
        Args: { p_investor_ids: string[]; p_manager_id: string | null };
        Returns: Json;
      };
    };
    Enums: {
      user_role: "super_admin" | "administrator" | "finance" | "operations" | "customer_support" | "investor";
      investment_status: "active" | "matured" | "completed" | "cancelled";
      payment_status: "pending" | "approved" | "processing" | "paid" | "rejected";
      kyc_status: "pending" | "approved" | "rejected";
      series_name: "A" | "B" | "C";
      cycle_status: "upcoming" | "active" | "awaiting_profit_declaration" | "matured" | "completed";
      payment_type: "roi" | "capital";
      notification_type: "investment" | "roi" | "capital" | "maturity" | "payment" | "document" | "announcement" | "system";
      document_type: "agreement" | "certificate" | "statement" | "receipt" | "report" | "other";
      target_audience: "all" | "investors" | "admins";
      maturity_decision: "continue" | "exit" | "rollover_all" | "partial_exit";
    };
  };
};
