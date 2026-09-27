import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export interface NativeSticker {
  /** base64 WebP, 512x512, <= 100 KB for WhatsApp. */
  imageData: string;
  emojis: string[];
}

export interface NativePackPayload {
  identifier: string;
  name: string;
  publisher: string;
  /** base64 PNG, 96x96, <= 50 KB. */
  trayImageData: string;
  stickers: NativeSticker[];
}

export interface TelegramPackPayload {
  software: string;
  isAnimated: boolean;
  /** base64 PNG thumbnail. */
  thumbnailData?: string;
  stickers: { data: string; mimeType: string; emojis: string[] }[];
}

export type SupportedApp = 'whatsapp' | 'telegram';

interface StickerExportNativeModule {
  isAppInstalled(app: SupportedApp): boolean;
  sendPackToWhatsApp(payload: NativePackPayload): Promise<boolean>;
  sendPackToTelegram(payload: TelegramPackPayload): Promise<boolean>;
  /** Copies PNG files into the shared App Group so the Messages extension can read them. */
  copyStickersToAppGroup(appGroup: string, fileUris: string[]): Promise<number>;
  getAppGroupStickerCount(appGroup: string): Promise<number>;
  clearAppGroupStickers(appGroup: string): Promise<void>;
}

const nativeModule = requireOptionalNativeModule<StickerExportNativeModule>('StickerExportModule');

function unavailable(): Error {
  return Object.assign(
    new Error('StickerExportModule is only available in a native iOS build'),
    { code: 'native_module_unavailable' },
  );
}

export function isAppInstalled(app: SupportedApp): boolean {
  if (Platform.OS !== 'ios' || !nativeModule) return false;
  return nativeModule.isAppInstalled(app);
}

export async function sendPackToWhatsApp(payload: NativePackPayload): Promise<boolean> {
  if (!nativeModule) throw unavailable();
  return nativeModule.sendPackToWhatsApp(payload);
}

export async function sendPackToTelegram(payload: TelegramPackPayload): Promise<boolean> {
  if (!nativeModule) throw unavailable();
  return nativeModule.sendPackToTelegram(payload);
}

export async function copyStickersToAppGroup(
  appGroup: string,
  fileUris: string[],
): Promise<number> {
  if (!nativeModule) throw unavailable();
  return nativeModule.copyStickersToAppGroup(appGroup, fileUris);
}

export async function getAppGroupStickerCount(appGroup: string): Promise<number> {
  if (!nativeModule) return 0;
  return nativeModule.getAppGroupStickerCount(appGroup);
}

export async function clearAppGroupStickers(appGroup: string): Promise<void> {
  if (!nativeModule) return;
  await nativeModule.clearAppGroupStickers(appGroup);
}

export const isNativeExportAvailable = nativeModule !== null && nativeModule !== undefined;
