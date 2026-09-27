import type { ConfigContext, ExpoConfig } from 'expo/config';

const BUNDLE_ID = process.env.EXPO_PUBLIC_BUNDLE_ID ?? 'com.emetsolutions.stickermaker';
const APP_GROUP = `group.${BUNDLE_ID}.stickers`;
const SCHEME = 'stickers';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Sticker Studio',
  slug: 'sticker-studio',
  scheme: SCHEME,
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#0B0B0F',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: true,
    buildNumber: '1',
    // Sticker packs are handed to WhatsApp/Telegram through the system pasteboard,
    // so the app must be allowed to probe for those apps before offering the option.
    infoPlist: {
      LSApplicationQueriesSchemes: ['whatsapp', 'tg'],
      ITSAppUsesNonExemptEncryption: false,
      UIBackgroundModes: ['remote-notification'],
      NSPhotoLibraryUsageDescription:
        'Sticker Studio needs access to your photos so you can pick a picture to turn into a sticker.',
      NSPhotoLibraryAddUsageDescription:
        'Sticker Studio saves the stickers you export to your photo library.',
      NSCameraUsageDescription:
        'Sticker Studio uses the camera so you can shoot a new photo for your sticker.',
    },
    entitlements: {
      'com.apple.security.application-groups': [APP_GROUP],
    },
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
          NSPrivacyAccessedAPITypeReasons: ['C617.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace',
          NSPrivacyAccessedAPITypeReasons: ['E174.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime',
          NSPrivacyAccessedAPITypeReasons: ['35F9.1'],
        },
      ],
    },
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0B0B0F',
    },
    permissions: ['android.permission.POST_NOTIFICATIONS'],
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_AUDIO',
      'android.permission.READ_MEDIA_VIDEO',
    ],
  },
  plugins: [
    'expo-router',
    'expo-localization',
    'expo-secure-store',
    'expo-apple-authentication',
    'expo-font',
    'expo-web-browser',
    [
      'expo-image-picker',
      {
        photosPermission:
          'Sticker Studio needs access to your photos so you can pick a picture to turn into a sticker.',
        cameraPermission:
          'Sticker Studio uses the camera so you can shoot a new photo for your sticker.',
      },
    ],
    [
      'expo-media-library',
      {
        photosPermission:
          'Sticker Studio needs access to your photos so you can pick a picture to turn into a sticker.',
        savePhotosPermission: 'Sticker Studio saves exported stickers to your photo library.',
        isAccessMediaLocationEnabled: false,
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/notification-icon.png',
        color: '#7C5CFF',
      },
    ],
    [
      'expo-build-properties',
      {
        ios: { deploymentTarget: '16.0', useFrameworks: 'static' },
        android: { minSdkVersion: 24, compileSdkVersion: 36, targetSdkVersion: 36 },
      },
    ],
    '@bacons/apple-targets',
    [
      '@sentry/react-native/expo',
      {
        organization: process.env.SENTRY_ORG ?? 'set-SENTRY_ORG',
        project: process.env.SENTRY_PROJECT ?? 'set-SENTRY_PROJECT',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    appGroup: APP_GROUP,
    eas: {
      projectId: process.env.EAS_PROJECT_ID ?? '00000000-0000-0000-0000-000000000000',
    },
  },
});
