export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      box_sale_clients: {
        Row: {
          client_id: string
          sale_id: string
        }
        Insert: {
          client_id: string
          sale_id: string
        }
        Update: {
          client_id?: string
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "box_sale_clients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "box_sale_clients_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "box_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      box_sales: {
        Row: {
          amount_received: number | null
          created_at: string
          customer_name: string
          device_cost: number | null
          extra_cost: number
          historical_source: string | null
          id: string
          model: string | null
          months_included: number
          notes: string | null
          quantity: number | null
          sale_date: string | null
          updated_at: string
        }
        Insert: {
          amount_received?: number | null
          created_at?: string
          customer_name: string
          device_cost?: number | null
          extra_cost?: number
          historical_source?: string | null
          id?: string
          model?: string | null
          months_included?: number
          notes?: string | null
          quantity?: number | null
          sale_date?: string | null
          updated_at?: string
        }
        Update: {
          amount_received?: number | null
          created_at?: string
          customer_name?: string
          device_cost?: number | null
          extra_cost?: number
          historical_source?: string | null
          id?: string
          model?: string | null
          months_included?: number
          notes?: string | null
          quantity?: number | null
          sale_date?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          access_type: string
          cost: number
          created_at: string
          due_date: string
          financial_due_date: string | null
          id: string
          login: string
          name: string
          notes: string | null
          paid: number
          prev_cost: number
          prev_paid: number
          referral_first_payment_confirmed: boolean
          referred_by_client_id: string | null
          server: string
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          access_type?: string
          cost?: number
          created_at?: string
          due_date: string
          financial_due_date?: string | null
          id?: string
          login: string
          name: string
          notes?: string | null
          paid?: number
          prev_cost?: number
          prev_paid?: number
          referral_first_payment_confirmed?: boolean
          referred_by_client_id?: string | null
          server: string
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          access_type?: string
          cost?: number
          created_at?: string
          due_date?: string
          financial_due_date?: string | null
          id?: string
          login?: string
          name?: string
          notes?: string | null
          paid?: number
          prev_cost?: number
          prev_paid?: number
          referral_first_payment_confirmed?: boolean
          referred_by_client_id?: string | null
          server?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_referred_by_client_id_fkey"
            columns: ["referred_by_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      external_renewal_jobs: {
        Row: {
          client_id: string | null
          client_name: string
          created_at: string
          expected_due_date: string
          external_http_status: number | null
          external_message: string | null
          external_order_id: string | null
          financial_due_date: string
          id: string
          idempotency_key: string
          local_values: Json
          login: string
          new_due_date: string
          server: string
          state: string
          synced_at: string | null
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          client_name: string
          created_at?: string
          expected_due_date: string
          external_http_status?: number | null
          external_message?: string | null
          external_order_id?: string | null
          financial_due_date: string
          id?: string
          idempotency_key?: string
          local_values: Json
          login: string
          new_due_date: string
          server: string
          state?: string
          synced_at?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          client_name?: string
          created_at?: string
          expected_due_date?: string
          external_http_status?: number | null
          external_message?: string | null
          external_order_id?: string | null
          financial_due_date?: string
          id?: string
          idempotency_key?: string
          local_values?: Json
          login?: string
          new_due_date?: string
          server?: string
          state?: string
          synced_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_renewal_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      external_simulation_jobs: {
        Row: {
          client_id: string | null
          completed_at: string | null
          created_at: string
          expected_due_date: string
          external_http_status: number | null
          external_message: string | null
          external_order_id: string | null
          id: string
          idempotency_key: string
          login: string
          panel_due_date: string | null
          server: string
          state: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          expected_due_date: string
          external_http_status?: number | null
          external_message?: string | null
          external_order_id?: string | null
          id?: string
          idempotency_key?: string
          login: string
          panel_due_date?: string | null
          server: string
          state?: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          expected_due_date?: string
          external_http_status?: number | null
          external_message?: string | null
          external_order_id?: string | null
          id?: string
          idempotency_key?: string
          login?: string
          panel_due_date?: string | null
          server?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_simulation_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      former_client_events: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          former_client_id: string
          from_status: string | null
          id: string
          note: string | null
          to_status: string | null
        }
        Insert: {
          action: string
          actor_id?: string
          created_at?: string
          former_client_id: string
          from_status?: string | null
          id?: string
          note?: string | null
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          former_client_id?: string
          from_status?: string | null
          id?: string
          note?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "former_client_events_former_client_id_fkey"
            columns: ["former_client_id"]
            isOneToOne: false
            referencedRelation: "former_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      former_clients: {
        Row: {
          contact_permission: string
          created_at: string
          id: string
          last_contacted_at: string | null
          linked_client_id: string | null
          monthly_value: number | null
          name: string
          notes: string | null
          origin: string
          phone: string | null
          recovered_at: string | null
          server: string | null
          status: string
          updated_at: string
        }
        Insert: {
          contact_permission?: string
          created_at?: string
          id?: string
          last_contacted_at?: string | null
          linked_client_id?: string | null
          monthly_value?: number | null
          name: string
          notes?: string | null
          origin?: string
          phone?: string | null
          recovered_at?: string | null
          server?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          contact_permission?: string
          created_at?: string
          id?: string
          last_contacted_at?: string | null
          linked_client_id?: string | null
          monthly_value?: number | null
          name?: string
          notes?: string | null
          origin?: string
          phone?: string | null
          recovered_at?: string | null
          server?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "former_clients_linked_client_id_fkey"
            columns: ["linked_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          client_id: string | null
          client_name: string
          cost: number
          created_at: string
          id: string
          paid_at: string
          server: string
        }
        Insert: {
          amount?: number
          client_id?: string | null
          client_name: string
          cost?: number
          created_at?: string
          id?: string
          paid_at?: string
          server: string
        }
        Update: {
          amount?: number
          client_id?: string | null
          client_name?: string
          cost?: number
          created_at?: string
          id?: string
          paid_at?: string
          server?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_point_movements: {
        Row: {
          client_id: string
          created_at: string
          id: string
          kind: string
          note: string | null
          points: number
          referred_client_id: string | null
          reversed_expiration_id: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          kind: string
          note?: string | null
          points: number
          referred_client_id?: string | null
          reversed_expiration_id?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          kind?: string
          note?: string | null
          points?: number
          referred_client_id?: string | null
          reversed_expiration_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_point_movements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_point_movements_referred_client_id_fkey"
            columns: ["referred_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_point_movements_reversed_expiration_id_fkey"
            columns: ["reversed_expiration_id"]
            isOneToOne: false
            referencedRelation: "referral_point_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_rewards: {
        Row: {
          client_id: string
          completed_at: string | null
          created_at: string
          id: string
          movement_id: string
          reward: string
          status: string
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          movement_id: string
          reward: string
          status?: string
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          movement_id?: string
          reward?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_rewards_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_rewards_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: true
            referencedRelation: "referral_point_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      reseller_sales: {
        Row: {
          cost_price: number
          created_at: string
          id: string
          quantity: number
          reseller_id: string
          sale_price: number
          sold_at: string
          updated_at: string
        }
        Insert: {
          cost_price: number
          created_at?: string
          id?: string
          quantity: number
          reseller_id: string
          sale_price: number
          sold_at?: string
          updated_at?: string
        }
        Update: {
          cost_price?: number
          created_at?: string
          id?: string
          quantity?: number
          reseller_id?: string
          sale_price?: number
          sold_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reseller_sales_reseller_id_fkey"
            columns: ["reseller_id"]
            isOneToOne: false
            referencedRelation: "resellers"
            referencedColumns: ["id"]
          },
        ]
      }
      resellers: {
        Row: {
          cost_price: number
          created_at: string
          id: string
          name: string
          sale_price: number
          updated_at: string
        }
        Insert: {
          cost_price: number
          created_at?: string
          id?: string
          name: string
          sale_price: number
          updated_at?: string
        }
        Update: {
          cost_price?: number
          created_at?: string
          id?: string
          name?: string
          sale_price?: number
          updated_at?: string
        }
        Relationships: []
      }
      server_credit_alerts: {
        Row: {
          created_at: string
          minimum_balance: number
          server: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          minimum_balance?: number
          server: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          minimum_balance?: number
          server?: string
          updated_at?: string
        }
        Relationships: []
      }
      server_credit_movements: {
        Row: {
          client_id: string | null
          created_at: string
          id: string
          kind: string
          note: string | null
          occurred_on: string
          quantity: number
          server: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          id?: string
          kind: string
          note?: string | null
          occurred_on?: string
          quantity: number
          server: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          note?: string | null
          occurred_on?: string
          quantity?: number
          server?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "server_credit_movements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          id: string
          overdue_whatsapp_template: string
          updated_at: string
          whatsapp_template: string
        }
        Insert: {
          id?: string
          overdue_whatsapp_template?: string
          updated_at?: string
          whatsapp_template?: string
        }
        Update: {
          id?: string
          overdue_whatsapp_template?: string
          updated_at?: string
          whatsapp_template?: string
        }
        Relationships: []
      }
      whatsapp_migration_tracking: {
        Row: {
          agenda_updated: boolean
          client_id: string
          payer_name: string | null
          phone_reviewed: boolean
          replied_at: string | null
          sent_at: string | null
          updated_at: string
        }
        Insert: {
          agenda_updated?: boolean
          client_id: string
          payer_name?: string | null
          phone_reviewed?: boolean
          replied_at?: string | null
          sent_at?: string | null
          updated_at?: string
        }
        Update: {
          agenda_updated?: boolean
          client_id?: string
          payer_name?: string | null
          phone_reviewed?: boolean
          replied_at?: string | null
          sent_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_migration_tracking_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      referral_award: {
        Args: {
          p_client_id: string
          p_payment_confirmed: boolean
          p_referred_client_id: string
        }
        Returns: undefined
      }
      referral_claim: {
        Args: { p_client_id: string; p_reward: string }
        Returns: string
      }
      referral_expire_client: { Args: { p_client_id: string }; Returns: number }
      referral_mark_delivered: {
        Args: { p_reward_id: string }
        Returns: undefined
      }
      referral_reset_expired: { Args: never; Returns: number }
      referral_restore_expiration: {
        Args: { p_client_id: string; p_expiration_id: string }
        Returns: number
      }
      referral_use_free_month: {
        Args: { p_client_id: string; p_expected_due_date: string }
        Returns: string
      }
      renew_client_with_credit: {
        Args: {
          p_client_id: string
          p_cost: number
          p_due_date: string
          p_expected_due_date: string
          p_financial_due_date: string
          p_monthly_paid: number
          p_payment_amount?: number
          p_payment_cost?: number
          p_prev_paid: number
        }
        Returns: undefined
      }
      sync_overdue_former_clients: { Args: never; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
