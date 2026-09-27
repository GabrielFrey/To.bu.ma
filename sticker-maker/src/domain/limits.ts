/**
 * Hard limits. The WhatsApp/Telegram numbers come from the third-party sticker
 * specs and are enforced on the server too — the client copy exists so the UI can
 * block an action before the user spends credits on it.
 */
export const LIMITS = {
  stickerTextMaxLength: 24,
  additionalInstructionsMaxLength: 255,
  topicMaxLength: 60,
  packNameMaxLength: 32,

  whatsapp: {
    minStickers: 3,
    maxStickers: 30,
    stickerSize: 512,
    stickerMaxBytes: 100 * 1024,
    trayIconSize: 96,
    trayIconMaxBytes: 50 * 1024,
    maxEmojisPerSticker: 3,
  },

  telegram: {
    minStickers: 1,
    maxStickers: 120,
    stickerSize: 512,
  },

  stickerCacheMaxBytes: 200 * 1024 * 1024,
  libraryPageSize: 30,
} as const;

export const COSTS = {
  generation: 1,
  exportPerSticker: 1,
} as const;
