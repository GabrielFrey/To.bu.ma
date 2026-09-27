import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/** Haptics are an iOS affordance; calling them on other platforms is a no-op. */
function run(action: () => Promise<void>): void {
  if (Platform.OS !== 'ios') return;
  void action().catch(() => undefined);
}

export const haptics = {
  tap: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  press: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  selection: () => run(() => Haptics.selectionAsync()),
};
