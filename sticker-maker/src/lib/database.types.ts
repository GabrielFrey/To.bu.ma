/**
 * Hand-maintained mirror of `supabase/migrations`. Regenerate with:
 *   supabase gen types typescript --local > src/lib/database.types.ts
 * It is committed so `tsc` works without a running database.
 *
 * The `Relationships` members are part of the shape supabase-js needs to infer
 * insert/update payloads; without them every mutation collapses to `never`.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type GenerationStatusRow = 'queued' | 'running' | 'done' | 'failed';
export type LedgerKindRow = 'grant' | 'bonus' | 'purchase' | 'consume' | 'refund';
export type CreditKindRow = 'generation' | 'export';

export interface CreditResultRow {
  generation_credits: number;
  export_credits: number;
  charged: boolean;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          locale: string | null;
          is_anonymous: boolean;
          generation_credits: number;
          export_credits: number;
          first_export_bonus_granted: boolean;
          sign_in_bonus_granted: boolean;
          analytics_opt_out: boolean;
          push_token: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          locale?: string | null;
          is_anonymous?: boolean;
          generation_credits?: number;
          export_credits?: number;
          first_export_bonus_granted?: boolean;
          sign_in_bonus_granted?: boolean;
          analytics_opt_out?: boolean;
          push_token?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          locale?: string | null;
          is_anonymous?: boolean;
          generation_credits?: number;
          export_credits?: number;
          first_export_bonus_granted?: boolean;
          sign_in_bonus_granted?: boolean;
          analytics_opt_out?: boolean;
          push_token?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      credit_ledger: {
        Row: {
          id: string;
          user_id: string;
          kind: CreditKindRow;
          reason: LedgerKindRow;
          delta: number;
          ref_type: string | null;
          ref_id: string | null;
          request_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          kind: CreditKindRow;
          reason: LedgerKindRow;
          delta: number;
          ref_type?: string | null;
          ref_id?: string | null;
          request_id: string;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      generations: {
        Row: {
          id: string;
          user_id: string;
          status: GenerationStatusRow;
          source_path: string;
          emotion: string | null;
          sticker_text: string | null;
          additional_instructions: string | null;
          prompt: string;
          provider: string | null;
          model: string | null;
          result_path: string | null;
          error_code: string | null;
          request_id: string;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          source_path: string;
          prompt: string;
          request_id: string;
          emotion?: string | null;
          sticker_text?: string | null;
          additional_instructions?: string | null;
          status?: GenerationStatusRow;
          provider?: string | null;
          model?: string | null;
          result_path?: string | null;
          error_code?: string | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          status?: GenerationStatusRow;
          provider?: string | null;
          model?: string | null;
          result_path?: string | null;
          error_code?: string | null;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      stickers: {
        Row: {
          id: string;
          user_id: string;
          generation_id: string | null;
          png_path: string;
          webp_path: string | null;
          emojis: string[];
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          png_path: string;
          generation_id?: string | null;
          webp_path?: string | null;
          emojis?: string[];
          created_at?: string;
        };
        Update: {
          png_path?: string;
          webp_path?: string | null;
          emojis?: string[];
        };
        Relationships: [
          {
            foreignKeyName: 'stickers_generation_id_fkey';
            columns: ['generation_id'];
            isOneToOne: false;
            referencedRelation: 'generations';
            referencedColumns: ['id'];
          },
        ];
      };
      packs: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          publisher: string;
          tray_sticker_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          publisher?: string;
          tray_sticker_id?: string | null;
          created_at?: string;
        };
        Update: {
          name?: string;
          publisher?: string;
          tray_sticker_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'packs_tray_sticker_id_fkey';
            columns: ['tray_sticker_id'];
            isOneToOne: false;
            referencedRelation: 'stickers';
            referencedColumns: ['id'];
          },
        ];
      };
      pack_stickers: {
        Row: {
          pack_id: string;
          sticker_id: string;
          position: number;
          created_at: string;
        };
        Insert: {
          pack_id: string;
          sticker_id: string;
          position: number;
          created_at?: string;
        };
        Update: { position?: number };
        Relationships: [
          {
            foreignKeyName: 'pack_stickers_pack_id_fkey';
            columns: ['pack_id'];
            isOneToOne: false;
            referencedRelation: 'packs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pack_stickers_sticker_id_fkey';
            columns: ['sticker_id'];
            isOneToOne: false;
            referencedRelation: 'stickers';
            referencedColumns: ['id'];
          },
        ];
      };
      purchases: {
        Row: {
          id: string;
          user_id: string;
          store: string;
          product_id: string;
          transaction_id: string;
          generation_credits_granted: number;
          export_credits_granted: number;
          raw: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          store: string;
          product_id: string;
          transaction_id: string;
          generation_credits_granted: number;
          export_credits_granted: number;
          raw?: Json;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      feedback: {
        Row: {
          id: string;
          user_id: string;
          sticker_id: string;
          value: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          sticker_id: string;
          value: number;
          created_at?: string;
        };
        Update: { value?: number };
        Relationships: [];
      };
      reports: {
        Row: {
          id: string;
          user_id: string;
          sticker_id: string | null;
          reason: string;
          details: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          reason: string;
          sticker_id?: string | null;
          details?: string | null;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      support_messages: {
        Row: {
          id: string;
          user_id: string;
          subject: string;
          body: string;
          diagnostics: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          subject: string;
          body: string;
          diagnostics?: Json;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      pack_sticker_counts: {
        Row: { pack_id: string | null; sticker_count: number | null };
        Relationships: [];
      };
    };
    Functions: {
      consume_credits: {
        Args: {
          p_kind: CreditKindRow;
          p_amount: number;
          p_request_id: string;
          p_ref_type?: string | null;
          p_ref_id?: string | null;
        };
        Returns: CreditResultRow[];
      };
      grant_credits: {
        Args: {
          p_kind: CreditKindRow;
          p_amount: number;
          p_reason: LedgerKindRow;
          p_request_id: string;
          p_user_id?: string | null;
        };
        Returns: CreditResultRow[];
      };
      refund_generation: {
        Args: { p_generation_id: string };
        Returns: CreditResultRow[];
      };
      claim_sign_in_bonus: {
        Args: Record<string, never>;
        Returns: CreditResultRow[];
      };
      claim_first_export_bonus: {
        Args: Record<string, never>;
        Returns: CreditResultRow[];
      };
      reorder_pack_stickers: {
        Args: { p_pack_id: string; p_sticker_ids: string[] };
        Returns: undefined;
      };
      check_rate_limit: {
        Args: {
          p_user_id: string;
          p_action: string;
          p_limit: number;
          p_window_seconds?: number;
        };
        Returns: boolean;
      };
      delete_own_account: {
        Args: Record<string, never>;
        Returns: undefined;
      };
    };
    Enums: {
      generation_status: GenerationStatusRow;
      ledger_reason: LedgerKindRow;
      credit_kind: CreditKindRow;
    };
    CompositeTypes: {
      credit_result: CreditResultRow;
    };
  };
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
