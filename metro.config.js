const { withSentryConfig } = require('@sentry/react-native/metro');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = withSentryConfig(config);
