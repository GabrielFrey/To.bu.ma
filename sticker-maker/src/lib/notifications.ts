import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { captureError } from './observability';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export interface StickerReadyPayload {
  type: 'sticker_ready';
  generationId: string;
}

export function parseNotificationData(data: unknown): StickerReadyPayload | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (record.type !== 'sticker_ready' || typeof record.generationId !== 'string') {
    return null;
  }
  return { type: 'sticker_ready', generationId: record.generationId };
}

export async function hasNotificationPermission(): Promise<boolean> {
  const settings = await Notifications.getPermissionsAsync();
  return settings.status === 'granted';
}

/**
 * Asked for at the moment it pays off — right before the first generation — rather than
 * on launch, which is the fastest way to get the prompt denied forever.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.status === 'granted') return true;
  if (!current.canAskAgain) return false;

  const result = await Notifications.requestPermissionsAsync();
  return result.status === 'granted';
}

export async function registerPushToken(userId: string): Promise<string | null> {
  try {
    if (!(await hasNotificationPermission())) return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
      });
    }

    const token = await Notifications.getExpoPushTokenAsync();
    await supabase.from('profiles').update({ push_token: token.data }).eq('id', userId);
    return token.data;
  } catch (error) {
    // Push is a convenience: Realtime still updates the UI when the app is open.
    captureError(error, { scope: 'registerPushToken' });
    return null;
  }
}

export async function clearPushToken(userId: string): Promise<void> {
  await supabase.from('profiles').update({ push_token: null }).eq('id', userId);
}

export async function clearBadge(): Promise<void> {
  await Notifications.setBadgeCountAsync(0).catch(() => undefined);
}
