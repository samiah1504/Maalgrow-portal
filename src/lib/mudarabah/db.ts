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

export type MudarabahCycleRow = {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  currency: string;
  slot_price: number;
  slots: number;
  ratio: number;
  wht: number;
  status: string;
  disclose_mode: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MudarabahHoldingRow = {
  id: string;
  cycle_id: string;
  investor_id: string;
  slots: number;
  capital_action: string;
  created_at: string;
  updated_at: string;
};

export type MudarabahSettlementRow = {
  id: string;
  cycle_id: string;
  settled_at: string;
  settled_by: string | null;
  engine_version: string;
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
  investor_id: string;
  slots: number;
  capital: number;
  profit: number;
  capital_action: string;
  amount_paid: number;
  amount_paid_note: string | null;
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

export type MudarabahCycleEventRow = {
  id: string;
  cycle_id: string;
  settlement_id: string | null;
  action: string;
  reason: string | null;
  actor_id: string | null;
  created_at: string;
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
      mudarabah_cycles: Table<MudarabahCycleRow>;
      mudarabah_holdings: Table<MudarabahHoldingRow>;
      mudarabah_settlements: Table<MudarabahSettlementRow>;
      mudarabah_settlement_holders: Table<MudarabahSettlementHolderRow>;
      mudarabah_settlement_products: Table<MudarabahSettlementProductRow>;
      mudarabah_balance_entries: Table<MudarabahBalanceEntryRow>;
      mudarabah_cycle_events: Table<MudarabahCycleEventRow>;
    };
    Views: Record<string, never>;
    Functions: {
      mudarabah_save_cycle: {
        Args: { p_cycle: unknown };
        Returns: string;
      };
      mudarabah_get_cycle: {
        Args: { p_cycle_id: string };
        Returns: unknown;
      };
      mudarabah_set_holding: {
        Args: {
          p_cycle_id: string;
          p_investor_id: string;
          p_slots: number;
          p_capital_action: string;
        };
        Returns: string;
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
