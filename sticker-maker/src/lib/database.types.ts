/**
 * Hand-maintained mirror of `supabase/migrations`. Regenerate with:
 *   supabase gen types typescript --local > src/lib/database.types.ts
 * It is committed so `tsc` works without a running database.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type GenerationStatusRow = 'queued' | 'running' | 'done' | 'failed';
export type LedgerKindRow = 'grant' | 'bonus' | 'purchase' | 'consume' | 'refund';
export type CreditKindRow = 'generation' | 'export';

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
          analytics_opt_out?: boolean;
          push_token?: string | null;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
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
        Insert: Omit<Database['public']['Tables']['credit_ledger']['Row'], 'id' | 'created_at'>;
        Update: never;
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
          user_id: string;
          source_path: string;
          prompt: string;
          request_id: string;
          emotion?: string | null;
          sticker_text?: string | null;
          additional_instructions?: string | null;
          status?: GenerationStatusRow;
        };
        Update: Partial<Database['public']['Tables']['generations']['Row']>;
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
          user_id: string;
          png_path: string;
          generation_id?: string | null;
          webp_path?: string | null;
          emojis?: string[];
        };
        Update: Partial<Database['public']['Tables']['stickers']['Row']>;
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
          user_id: string;
          name: string;
          publisher?: string;
          tray_sticker_id?: string | null;
        };
        Update: Partial<Database['public']['Tables']['packs']['Row']>;
      };
      pack_stickers: {
        Row: {
          pack_id: string;
          sticker_id: string;
          position: number;
          created_at: string;
        };
        Insert: { pack_id: string; sticker_id: string; position: number };
        Update: Partial<Database['public']['Tables']['pack_stickers']['Row']>;
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
        Insert: Omit<Database['public']['Tables']['purchases']['Row'], 'id' | 'created_at'>;
        Update: never;
      };
      feedback: {
        Row: {
          id: string;
          user_id: string;
          sticker_id: string;
          value: number;
          created_at: string;
        };
        Insert: { user_id: string; sticker_id: string; value: number };
        Update: Partial<Database['public']['Tables']['feedback']['Row']>;
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
          user_id: string;
          reason: string;
          sticker_id?: string | null;
          details?: string | null;
        };
        Update: never;
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
          user_id: string;
          subject: string;
          body: string;
          diagnostics?: Json;
        };
        Update: never;
      };
    };
    Views: {
      pack_sticker_counts: {
        Row: { pack_id: string; sticker_count: number };
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
        Returns: {
          generation_credits: number;
          export_credits: number;
          charged: boolean;
        }[];
      };
      grant_credits: {
        Args: {
          p_kind: CreditKindRow;
          p_amount: number;
          p_reason: LedgerKindRow;
          p_request_id: string;
        };
        Returns: {
          generation_credits: number;
          export_credits: number;
          charged: boolean;
        }[];
      };
      reorder_pack_stickers: {
        Args: { p_pack_id: string; p_sticker_ids: string[] };
        Returns: undefined;
      };
      claim_sign_in_bonus: {
        Args: Record<string, never>;
        Returns: {
          generation_credits: number;
          export_credits: number;
          charged: boolean;
        }[];
      };
    };
    Enums: {
      generation_status: GenerationStatusRow;
      ledger_reason: LedgerKindRow;
      credit_kind: CreditKindRow;
    };
  };
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
