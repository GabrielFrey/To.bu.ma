export type CreditKind = 'generation' | 'export';

export type LedgerKind = 'grant' | 'bonus' | 'purchase' | 'consume' | 'refund';

export type GenerationStatus = 'queued' | 'running' | 'done' | 'failed';

export type ExportTarget = 'gallery' | 'whatsapp' | 'telegram' | 'share' | 'imessage';

export interface CreditBalance {
  generation: number;
  export: number;
}

export interface Profile {
  id: string;
  locale: string | null;
  isAnonymous: boolean;
  generationCredits: number;
  exportCredits: number;
  firstExportBonusGranted: boolean;
  analyticsOptOut: boolean;
  createdAt: string;
}

export interface Generation {
  id: string;
  status: GenerationStatus;
  emotion: string | null;
  stickerText: string | null;
  additionalInstructions: string | null;
  prompt: string;
  resultPath: string | null;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface Sticker {
  id: string;
  generationId: string | null;
  pngPath: string;
  webpPath: string | null;
  emojis: string[];
  createdAt: string;
}

export interface Pack {
  id: string;
  name: string;
  publisher: string;
  trayStickerId: string | null;
  createdAt: string;
  stickerCount: number;
}

export interface PackSticker extends Sticker {
  position: number;
}

/** Stable, human readable failure reasons surfaced to the UI through i18n keys. */
export type GenerationErrorCode =
  | 'provider_timeout'
  | 'provider_error'
  | 'moderation_blocked'
  | 'invalid_image'
  | 'insufficient_credits'
  | 'rate_limited'
  | 'unknown';
