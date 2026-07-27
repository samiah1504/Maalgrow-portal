/**
 * Supabase typing for the Mudarabah tables and functions.
 *
 * The portal's generated types live in src/lib/types/database.types.ts.
 * That file is hand-maintained and shared by everything, so rather than
 * edit it, this module declares the shape of the new tables on its own
 * and narrows a client to them. When the shared types file is next
 * regenerated these can move across and this module can go.
 *
 * All money columns are integer kobo (BIGINT).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type MudarabahLedgerRow = {
  id: string;
  cycle_id: string;
  description: string | null;
  disclose_mode: string;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** The existing cycle, with the ledger's per-cycle term overrides */
export type CycleRow = {
  id: string;
  series_id: string;
  cycle_number: number;
  cycle_label: string;
  start_date: string;
  end_date: string;
  status: string;
  unit_value: number | null;
  investor_ratio: number | null;
  wht_rate: number | null;
  total_slots: number;
  total_capital: number;
  total_investors: number;
  amount_received: number;
};

export type SeriesRow = {
  id: string;
  name: string;
  price_per_unit: number;
  mudarabah_investor_ratio: number;
  default_wht_rate: number;
};

export type MudarabahSettlementRow = {
  id: string;
  cycle_id: string;
  ledger_id: string;
  settled_at: string;
  settled_by: string | null;
  engine_version: string;
  ratio_used: number;
  unit_value_used: number;
  wht_rate_used: number;
  computed: unknown;
  is_current: boolean;
  superseded_at: string | null;
  superseded_by: string | null;
  supersede_reason: string | null;
  created_at: string;
};

export type MudarabahSettlementHolderRow = {
  id: string;
  settlement_id: string;
  investment_id: string;
  investor_id: string;
  units: number;
  capital: number;
  gross_profit: number;
  wht: number;
  net_profit: number;
  capital_action: string;
  slots_withdrawn: number;
  amount_paid: number;
  amount_paid_note: string | null;
  payment_request_id: string | null;
};

export type MudarabahSettlementProductRow = {
  id: string;
  settlement_id: string;
  product_key: string;
  product_name: string;
  units_bought: number;
  units_sold: number;
  units_left: number;
  revenue: number;
  cogs: number;
  gross: number;
  gross_margin: number;
};

export type MudarabahBalanceEntryRow = {
  id: string;
  cycle_id: string;
  settlement_id: string;
  investor_id: string;
  entry_type: string;
  amount: number;
  note: string | null;
  created_at: string;
};

export type WhtIssuerSettingsRow = {
  id: number;
  company_name: string;
  company_address: string | null;
  company_tin: string | null;
  signatory_name: string | null;
  signatory_title: string | null;
  seal_url: string | null;
  updated_at: string;
};

export type MudarabahCycleEventRow = {
  id: string;
  cycle_id: string;
  settlement_id: string | null;
  action: string;
  reason: string | null;
  actor_id: string | null;
  created_at: string;
};

/** A generated document: the file an investor downloads AND is emailed. */
export type MudarabahStatementRow = {
  id: string;
  cycle_id: string;
  settlement_id: string;
  investment_id: string;
  investor_id: string;
  kind: string;
  storage_path: string | null;
  state: string;
  attempts: number;
  last_error: string | null;
  bytes: number | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
};

/** A frozen credit note. The document renders this and computes nothing. */
export type WhtCreditNoteRow = {
  id: string;
  reference: string;
  cycle_id: string;
  settlement_id: string;
  remittance_id: string | null;
  investment_id: string;
  investor_id: string;
  investor_name: string;
  investor_address: string | null;
  investor_tin: string | null;
  period_start: string;
  period_end: string;
  gross_profit: number;
  wht_rate: number;
  wht_amount: number;
  net_paid: number;
  deducted_on: string;
  remittance_reference: string | null;
  remitted_at: string | null;
  filed_on: string | null;
  issued_at: string;
  reissue_count: number;
};

/** A filing with the tax authority. One filing may cover several cycles. */
export type WhtRemittanceRow = {
  id: string;
  reference: string;
  remitted_on: string;
  amount: number;
  authority: string | null;
  notes: string | null;
  recorded_by: string | null;
  recorded_at: string;
};

/** Read-only: the few investor columns a statement needs to be addressed. */
export type InvestorRow = {
  id: string;
  full_name: string;
  investor_code: string;
  tin: string | null;
  address: string | null;
};

/**
 * Read-only, and only the columns the report needs. The maturity
 * instruction is what decides whether an investor's capital continues
 * — the ledger never records it, it only reads it.
 */
export type RolloverDecisionRow = {
  investment_id: string;
  source_cycle_id: string;
  decision: string;
  slots_to_withdraw: number | null;
};

/**
 * A membership row, as the pickers read it.
 *
 * These are the rows that decide how much capital is actually in a
 * cycle. cycles.total_slots is a running total maintained by trigger
 * deltas and can drift; this is the thing itself.
 */
export type InvestmentMembershipRow = {
  id: string;
  cycle_id: string;
  investor_id: string;
  units: number;
  capital: number;
  status: string;
};

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type MudarabahDatabase = {
  public: {
    Tables: {
      mudarabah_ledgers: Table<MudarabahLedgerRow>;
      cycles: Table<CycleRow>;
      series: Table<SeriesRow>;
      investments: Table<InvestmentMembershipRow>;
      mudarabah_settlements: Table<MudarabahSettlementRow>;
      mudarabah_settlement_holders: Table<MudarabahSettlementHolderRow>;
      mudarabah_settlement_products: Table<MudarabahSettlementProductRow>;
      mudarabah_balance_entries: Table<MudarabahBalanceEntryRow>;
      mudarabah_cycle_events: Table<MudarabahCycleEventRow>;
      wht_issuer_settings: Table<WhtIssuerSettingsRow>;
      rollover_decisions: Table<RolloverDecisionRow>;
      wht_credit_notes: Table<WhtCreditNoteRow>;
      mudarabah_statements: Table<MudarabahStatementRow>;
      investors: Table<InvestorRow>;
      wht_remittances: Table<WhtRemittanceRow>;
      wht_remittance_cycles: Table<{ remittance_id: string; cycle_id: string }>;
    };
    Views: Record<string, never>;
    Functions: {
      mudarabah_save_ledger: {
        Args: { p_ledger: unknown };
        Returns: string;
      };
      mudarabah_get_ledger: {
        Args: { p_cycle_id: string };
        Returns: unknown;
      };
      mudarabah_set_cycle_terms: {
        Args: {
          p_cycle_id: string;
          p_investor_ratio?: number | null;
          p_unit_value?: number | null;
          p_wht_rate?: number | null;
        };
        Returns: undefined;
      };
      // Migration 025 — separate from set_cycle_terms because the
      // withholding rate is statutory, not a term investors agreed to,
      // and stays correctable until settlement rather than until
      // subscriptions close.
      mudarabah_set_wht_rate: {
        Args: {
          p_cycle_id: string;
          p_rate: number;
          p_reason?: string | null;
        };
        Returns: unknown;
      };
      // Migration 026 — after subscriptions close the slot holders'
      // share may only rise. A smaller manager's share is a gift and
      // is always allowed; a larger one breaks the bargain investors
      // subscribed on.
      mudarabah_set_investor_ratio: {
        Args: {
          p_cycle_id: string;
          p_ratio: number;
          p_reason?: string | null;
        };
        Returns: unknown;
      };
      mudarabah_settle_cycle: {
        Args: {
          p_cycle_id: string;
          p_engine_version: string;
          p_computed: unknown;
          p_holders: unknown;
          p_products?: unknown;
        };
        Returns: string;
      };
      mudarabah_unsettle_cycle: {
        Args: { p_cycle_id: string; p_reason: string };
        Returns: string;
      };
      mudarabah_update_issuer_settings: {
        Args: {
          p_company_name: string;
          p_company_address?: string | null;
          p_company_tin?: string | null;
          p_signatory_name?: string | null;
          p_signatory_title?: string | null;
          p_seal_url?: string | null;
        };
        Returns: undefined;
      };
      mudarabah_issue_credit_notes: {
        Args: {
          p_remittance_id: string;
          p_cycle_id?: string | null;
          p_investment_id?: string | null;
        };
        Returns: unknown;
      };
      mudarabah_create_remittance: {
        Args: {
          p_reference: string;
          p_remitted_on: string;
          p_amount: number;
          p_cycle_ids: string[];
          p_authority?: string | null;
          p_notes?: string | null;
        };
        Returns: string;
      };
      mudarabah_issuance_preview: {
        Args: { p_remittance_id: string };
        Returns: unknown;
      };
      mudarabah_wht_overview: {
        Args: Record<string, never>;
        Returns: unknown;
      };
      mudarabah_my_credit_note: {
        Args: { p_cycle_id: string };
        Returns: unknown;
      };
      mudarabah_queue_statements: {
        Args: { p_settlement_id: string };
        Returns: number;
      };
      mudarabah_requeue_statements: {
        Args: { p_cycle_id: string };
        Returns: number;
      };
      mudarabah_mark_statement: {
        Args: {
          p_id: string;
          p_state: string;
          p_path?: string | null;
          p_bytes?: number | null;
          p_error?: string | null;
        };
        Returns: undefined;
      };
      mudarabah_my_statement: {
        Args: { p_cycle_id: string };
        Returns: unknown;
      };
      mudarabah_statement_status: {
        Args: { p_cycle_id: string };
        Returns: unknown;
      };
      mudarabah_investor_cycle_history: {
        Args: { p_investor_id: string };
        Returns: unknown;
      };
      mudarabah_record_payment: {
        Args: {
          p_settlement_id: string;
          p_investor_id: string;
          p_amount_paid: number;
          p_note: string;
        };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type MudarabahClient = SupabaseClient<MudarabahDatabase>;

/**
 * Narrow an existing Supabase client to the Mudarabah tables. The
 * client itself is unchanged — this only swaps which generated types
 * the query builder is checked against.
 */
export function mudarabahDb(client: unknown): MudarabahClient {
  return client as unknown as MudarabahClient;
}
