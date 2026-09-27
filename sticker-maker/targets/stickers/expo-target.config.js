const BUNDLE_ID = process.env.EXPO_PUBLIC_BUNDLE_ID ?? 'com.emetsolutions.stickermaker';

/**
 * iMessage sticker extension. Apple's own template bakes a static asset catalogue into
 * the extension, which cannot work for stickers the user generates at runtime, so this
 * target ships a `MSStickerBrowserViewController` subclass that reads the PNG files the
 * app copies into the shared App Group container.
 *
 * The class is named `StickerBrowserViewController` on purpose: that is the
 * `NSExtensionPrincipalClass` the plugin writes into the generated Info.plist.
 *
 * @type {import('@bacons/apple-targets').ConfigFunction}
 */
module.exports = (config) => ({
  type: 'imessage',
  name: 'Stickers',
  displayName: config.name ?? 'Sticker Studio',
  icon: '../../assets/icon.png',
  frameworks: ['Messages'],
  deploymentTarget: '16.0',
  entitlements: {
    'com.apple.security.application-groups': [`group.${BUNDLE_ID}.stickers`],
  },
});
