// Native modules that have no JS fallback inside jest-expo.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    isAvailableAsync: jest.fn(async () => true),
    WHEN_UNLOCKED: 'whenUnlocked',
  };
});

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: false })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: false })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test]' })),
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  AndroidImportance: { MAX: 5 },
}));

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    setLogLevel: jest.fn(),
    logIn: jest.fn(async () => ({ customerInfo: { entitlements: { active: {} } } })),
    logOut: jest.fn(async () => undefined),
    getOfferings: jest.fn(async () => ({ current: null, all: {} })),
    purchasePackage: jest.fn(async () => ({ customerInfo: { entitlements: { active: {} } } })),
    restorePurchases: jest.fn(async () => ({ entitlements: { active: {} } })),
    getCustomerInfo: jest.fn(async () => ({ entitlements: { active: {} } })),
  },
  LOG_LEVEL: { ERROR: 'ERROR', DEBUG: 'DEBUG' },
  PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: '1' },
}));

jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
  setUser: jest.fn(),
  wrap: (component: unknown) => component,
  reactNavigationIntegration: jest.fn(() => ({ registerNavigationContainer: jest.fn() })),
  mobileReplayIntegration: jest.fn(() => ({})),
}));

jest.mock('posthog-react-native', () => ({
  PostHog: class {
    capture = jest.fn();
    identify = jest.fn();
    reset = jest.fn();
    optIn = jest.fn();
    optOut = jest.fn();
    screen = jest.fn();
  },
}));

jest.mock('expo-store-review', () => ({
  isAvailableAsync: jest.fn(async () => false),
  requestReview: jest.fn(async () => undefined),
}));

jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(async () => true),
  signInAsync: jest.fn(async () => ({ identityToken: 'token', fullName: null, email: null })),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  AppleAuthenticationButton: () => null,
  AppleAuthenticationButtonType: { SIGN_IN: 0 },
  AppleAuthenticationButtonStyle: { BLACK: 0, WHITE: 1 },
}));

jest.mock('../modules/sticker-export', () => ({
  isAppInstalled: jest.fn(() => true),
  sendPackToWhatsApp: jest.fn(async () => true),
  sendPackToTelegram: jest.fn(async () => true),
  copyStickersToAppGroup: jest.fn(async () => 0),
  getAppGroupStickerCount: jest.fn(async () => 0),
  clearAppGroupStickers: jest.fn(async () => undefined),
  isNativeExportAvailable: true,
}));

jest.spyOn(console, 'warn').mockImplementation(() => undefined);
