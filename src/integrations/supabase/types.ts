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
      clients: {
        Row: {
          access_type: "padrao" | "pacote_pago" | "gratuidade" | "meu_acesso"
          notes: string | null
          cost: number
          created_at: string
          due_date: string
          financial_due_date: string | null
          id: string
          login: string
          name: string
          paid: number
          prev_cost: number
          prev_paid: number
          server: string
          updated_at: string
          referred_by_client_id: string | null
          referral_first_payment_confirmed: boolean
          whatsapp: string | null
        }
        Insert: {
          access_type?: "padrao" | "pacote_pago" | "gratuidade" | "meu_acesso"
          notes?: string | null
          cost?: number
          created_at?: string
          due_date: string
          financial_due_date?: string | null
          id?: string
          login: string
          name: string
          paid?: number
          prev_cost?: number
          prev_paid?: number
          server: string
          updated_at?: string
          referred_by_client_id?: string | null
          referral_first_payment_confirmed?: boolean
          whatsapp?: string | null
        }
        Update: {
          access_type?: "padrao" | "pacote_pago" | "gratuidade" | "meu_acesso"
          notes?: string | null
          cost?: number
          created_at?: string
          due_date?: string
          financial_due_date?: string | null
          id?: string
          login?: string
          name?: string
          paid?: number
          prev_cost?: number
          prev_paid?: number
          server?: string
          updated_at?: string
          referred_by_client_id?: string | null
          referral_first_payment_confirmed?: boolean
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
      referral_point_movements: {
        Row: {
          id: string
          client_id: string
          referred_client_id: string | null
          kind: string
          points: number
          note: string | null
          reversed_expiration_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          client_id: string
          referred_client_id?: string | null
          kind: string
          points: number
          note?: string | null
          reversed_expiration_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          client_id?: string
          referred_client_id?: string | null
          kind?: string
          points?: number
          note?: string | null
          reversed_expiration_id?: string | null
          created_at?: string
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
            foreignKeyName: "referral_point_movements_reversed_expiration_id_fkey"
            columns: ["reversed_expiration_id"]
            isOneToOne: true
            referencedRelation: "referral_point_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_point_movements_referred_client_id_fkey"
            columns: ["referred_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_rewards: {
        Row: {
          id: string
          movement_id: string
          client_id: string
          reward: string
          status: string
          created_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          movement_id: string
          client_id: string
          reward: string
          status?: string
          created_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          movement_id?: string
          client_id?: string
          reward?: string
          status?: string
          created_at?: string
          completed_at?: string | null
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
      whatsapp_migration_tracking: {
        Row: {
          client_id: string
          phone_reviewed: boolean
          agenda_updated: boolean
          sent_at: string | null
          replied_at: string | null
          payer_name: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          phone_reviewed?: boolean
          agenda_updated?: boolean
          sent_at?: string | null
          replied_at?: string | null
          payer_name?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          phone_reviewed?: boolean
          agenda_updated?: boolean
          sent_at?: string | null
          replied_at?: string | null
          payer_name?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      referral_restore_expiration: {
        Args: { p_client_id: string; p_expiration_id: string }
        Returns: number
      }
      referral_award: {
        Args: { p_client_id: string; p_referred_client_id: string; p_payment_confirmed: boolean }
        Returns: undefined
      }
      referral_claim: {
        Args: { p_client_id: string; p_reward: string }
        Returns: string
      }
      referral_expire_client: {
        Args: { p_client_id: string }
        Returns: number
      }
      referral_mark_delivered: {
        Args: { p_reward_id: string }
        Returns: undefined
      }
      referral_reset_expired: {
        Args: Record<PropertyKey, never>
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
